#!/usr/bin/env node
// Render a Markdown architecture doc to PDF with no browser dependency.
// Usage: node build-pdf.mjs <input.md> <output.pdf>
// Deps: npm i pdfkit markdown-it   (both pure-JS; pdfkit ships its own base fonts)
// Fonts: embeds Ubuntu / Ubuntu Mono TTFs when found (so box-drawing diagrams render);
//        otherwise falls back to Helvetica/Courier and sanitizes non-Latin glyphs.

import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import MarkdownIt from 'markdown-it';

const [, , INPUT, OUTPUT] = process.argv;
if (!INPUT || !OUTPUT) { console.error('usage: node build-pdf.mjs <in.md> <out.pdf>'); process.exit(1); }

// ---- font resolution (best-effort, portable) --------------------------------
const FONT_CANDIDATES = {
  body: ['/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf'],
  bold: ['/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf'],
  italic: ['/usr/share/fonts/truetype/ubuntu/Ubuntu-RI.ttf'],
  mono: ['/usr/share/fonts/truetype/ubuntu/UbuntuMono-R.ttf'],
  monoBold: ['/usr/share/fonts/truetype/ubuntu/UbuntuMono-B.ttf'],
};
const pick = (arr) => arr.find((p) => fs.existsSync(p));
const F = Object.fromEntries(Object.entries(FONT_CANDIDATES).map(([k, v]) => [k, pick(v)]));
const EMBED = F.body && F.mono; // only embed if we at least have body + mono

// Standard-font fallback needs Latin-1; swap common non-WinAnsi glyphs to ASCII.
const SANITIZE = !EMBED;
function san(s) {
  if (!SANITIZE) {
    // Even with Ubuntu Mono, a few emoji/symbols aren't present — normalize those only.
    return s.replace(/✅/g, '[x]').replace(/⚠️?/g, '[!]').replace(/➖/g, '[-]')
            .replace(/❌/g, '[x]').replace(/•/g, '•');
  }
  return s
    .replace(/[│┃]/g, '|').replace(/[─━]/g, '-').replace(/[┌┬┐├┼┤└┴┘╔╗╚╝╠╣╦╩╬]/g, '+')
    .replace(/[►▶▸]/g, '>').replace(/[◄◀]/g, '<').replace(/[▼▾]/g, 'v').replace(/[▲▴]/g, '^')
    .replace(/✅/g, '[x]').replace(/⚠️?/g, '[!]').replace(/➖/g, '[-]').replace(/❌/g, '[x]')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[—–]/g, '-').replace(/•/g, '*')
    .replace(/…/g, '...').replace(/→/g, '->').replace(/⇄/g, '<->').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 54, right: 54 }, bufferPages: true });
doc.pipe(fs.createWriteStream(OUTPUT));

const FONTS = { body: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', mono: 'Courier', monoBold: 'Courier-Bold' };
if (EMBED) {
  doc.registerFont('body', F.body); FONTS.body = 'body';
  doc.registerFont('bold', F.bold || F.body); FONTS.bold = 'bold';
  doc.registerFont('italic', F.italic || F.body); FONTS.italic = 'italic';
  doc.registerFont('mono', F.mono); FONTS.mono = 'mono';
  doc.registerFont('monoBold', F.monoBold || F.mono); FONTS.monoBold = 'monoBold';
}

const PAGE_W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const md = new MarkdownIt();
const tokens = md.parse(fs.readFileSync(INPUT, 'utf8'), {});

// ---- inline rendering with styled runs --------------------------------------
function inlineRuns(tok) {
  const runs = []; let bold = false, italic = false, code = false;
  for (const c of tok.children || []) {
    if (c.type === 'text') runs.push({ t: san(c.content), bold, italic, code });
    else if (c.type === 'code_inline') runs.push({ t: san(c.content), bold, italic, code: true });
    else if (c.type === 'strong_open') bold = true; else if (c.type === 'strong_close') bold = false;
    else if (c.type === 'em_open') italic = true; else if (c.type === 'em_close') italic = false;
    else if (c.type === 'softbreak' || c.type === 'hardbreak') runs.push({ t: ' ', bold, italic, code });
    else if (c.type === 'link_open' || c.type === 'link_close') { /* keep link text only */ }
  }
  return runs;
}
function fontFor(r) { return r.code ? (r.bold ? FONTS.monoBold : FONTS.mono) : r.bold ? FONTS.bold : r.italic ? FONTS.italic : FONTS.body; }
function writeRuns(runs, opts = {}) {
  const size = opts.size || 10.5; let first = true;
  runs.forEach((r, i) => {
    doc.font(fontFor(r)).fontSize(size).fillColor(r.code ? '#b5330a' : '#1a1a1a');
    const last = i === runs.length - 1;
    doc.text(r.t, first ? undefined : doc.x, first ? undefined : doc.y, { continued: !last, indent: first ? (opts.indent || 0) : 0 });
    first = false;
  });
  if (runs.length === 0) doc.text(' ');
}

function heading(tok, next) {
  const level = Number(tok.tag.slice(1));
  const sizes = { 1: 21, 2: 16, 3: 13, 4: 11.5, 5: 10.5, 6: 10 };
  doc.moveDown(level <= 2 ? 0.7 : 0.5);
  const y = doc.y;
  doc.font(FONTS.bold).fontSize(sizes[level] || 11).fillColor(level === 1 ? '#0a3d62' : '#12507a');
  doc.text(san(next.content), { paragraphGap: 2 });
  if (level <= 2) { doc.moveTo(doc.page.margins.left, doc.y + 1).lineTo(doc.page.width - doc.page.margins.right, doc.y + 1).lineWidth(level === 1 ? 1.2 : 0.5).strokeColor('#c8d6e5').stroke(); doc.moveDown(0.3); }
  doc.fillColor('#1a1a1a');
}

function codeBlock(content) {
  const text = san(content.replace(/\n$/, ''));
  doc.moveDown(0.3);
  doc.font(FONTS.mono).fontSize(8.2);
  const lines = text.split('\n');
  const lh = doc.currentLineHeight() + 1.5;
  const padY = 5, padX = 7;
  // paginate the block, drawing a background rectangle per page-run
  let i = 0;
  while (i < lines.length) {
    const top = doc.y;
    const avail = doc.page.height - doc.page.margins.bottom - top - padY * 2;
    let n = Math.max(1, Math.min(lines.length - i, Math.floor(avail / lh)));
    const chunk = lines.slice(i, i + n);
    const h = chunk.length * lh + padY * 2;
    doc.save().rect(doc.page.margins.left, top, PAGE_W, h).fill('#f5f6fa').restore();
    doc.fillColor('#2c2c2c').font(FONTS.mono).fontSize(8.2);
    let ty = top + padY;
    for (const ln of chunk) { doc.text(ln || ' ', doc.page.margins.left + padX, ty, { lineBreak: false, width: PAGE_W - padX * 2 }); ty += lh; }
    doc.y = top + h; i += n;
    if (i < lines.length) doc.addPage();
  }
  doc.moveDown(0.4).fillColor('#1a1a1a');
}

// crude but reliable table: plain-text cells in a monospace grid
function renderTable(rows) {
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => { const c = r.slice(); while (c.length < cols) c.push(''); return c.map((x) => san(x)); });
  doc.font(FONTS.mono).fontSize(8);
  const charW = doc.widthOfString('M');
  const maxChars = Math.floor((PAGE_W - 8) / charW);
  // width per column by content, then scale down to fit
  let widths = new Array(cols).fill(0);
  for (const r of norm) r.forEach((c, j) => { widths[j] = Math.max(widths[j], c.length); });
  let total = widths.reduce((a, b) => a + b + 3, 1);
  if (total > maxChars) { const f = maxChars / total; widths = widths.map((w) => Math.max(4, Math.floor(w * f))); }
  const wrap = (s, w) => { const out = []; let line = ''; for (const word of s.split(/\s+/)) { if ((line + ' ' + word).trim().length > w) { if (line) out.push(line); line = word.length > w ? word.slice(0, w) : word; } else line = (line ? line + ' ' : '') + word; } if (line) out.push(line); return out.length ? out : ['']; };
  const drawRow = (cells, isHeader) => {
    const wrapped = cells.map((c, j) => wrap(c, widths[j]));
    const h = Math.max(...wrapped.map((w) => w.length));
    const lh = doc.currentLineHeight() + 1;
    if (doc.y + h * lh + 4 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const top = doc.y;
    if (isHeader) doc.save().rect(doc.page.margins.left, top - 1, PAGE_W, h * lh + 3).fill('#eaf0f6').restore();
    doc.font(isHeader ? FONTS.monoBold : FONTS.mono).fontSize(8).fillColor('#1a1a1a');
    for (let li = 0; li < h; li++) {
      let x = doc.page.margins.left + 2;
      for (let j = 0; j < cols; j++) {
        const txt = wrapped[j][li] || '';
        doc.text(txt, x, top + li * lh, { width: widths[j] * charW + 2, lineBreak: false });
        x += widths[j] * charW + 3 * charW;
      }
    }
    doc.y = top + h * lh + 2;
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).lineWidth(0.3).strokeColor('#d0d7de').stroke();
    doc.moveDown(0.15);
  };
  norm.forEach((r, i) => drawRow(r, i === 0));
  doc.moveDown(0.4);
}

// ---- token walk -------------------------------------------------------------
let listStack = [];
for (let i = 0; i < tokens.length; i++) {
  const t = tokens[i];
  switch (t.type) {
    case 'heading_open': heading(t, tokens[i + 1]); i += 2; break;
    case 'paragraph_open': {
      const inl = tokens[i + 1];
      if (listStack.length) { const lvl = listStack.length; const marker = listStack[lvl - 1].ordered ? `${listStack[lvl - 1].n++}. ` : '• ';
        doc.font(FONTS.body).fontSize(10.5).fillColor('#1a1a1a');
        doc.text(marker, doc.page.margins.left + (lvl - 1) * 14 + 2, doc.y, { continued: true, indent: 0 });
        writeRuns(inlineRuns(inl), { size: 10.5 });
      } else { doc.moveDown(0.15); writeRuns(inlineRuns(inl), { size: 10.5 }); }
      i += 2; break; }
    case 'bullet_list_open': listStack.push({ ordered: false }); break;
    case 'ordered_list_open': listStack.push({ ordered: true, n: 1 }); break;
    case 'bullet_list_close': case 'ordered_list_close': listStack.pop(); doc.moveDown(0.2); break;
    case 'blockquote_open': { doc.moveDown(0.2); const sy = doc.y; // gather inner paragraphs
      let depth = 1; const buf = []; let j = i + 1;
      while (j < tokens.length && depth > 0) { if (tokens[j].type === 'blockquote_open') depth++; else if (tokens[j].type === 'blockquote_close') depth--; if (depth > 0 && tokens[j].type === 'inline') buf.push(tokens[j]); j++; }
      doc.save();
      for (const inl of buf) { doc.font(FONTS.italic).fontSize(9.5).fillColor('#40515e'); const runs = inlineRuns(inl).map((r) => ({ ...r })); doc.text('', doc.page.margins.left + 12, doc.y); writeRuns(runs, { size: 9.5 }); doc.moveDown(0.2); }
      doc.restore(); doc.moveTo(doc.page.margins.left + 3, sy).lineTo(doc.page.margins.left + 3, doc.y).lineWidth(2).strokeColor('#c8d6e5').stroke();
      doc.moveDown(0.2); doc.fillColor('#1a1a1a'); i = j - 1; break; }
    case 'fence': case 'code_block': codeBlock(t.content); break;
    case 'hr': doc.moveDown(0.2).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).lineWidth(0.5).strokeColor('#c8d6e5').stroke().moveDown(0.4); break;
    case 'table_open': { const rows = []; let j = i + 1; let cur = null;
      while (j < tokens.length && tokens[j].type !== 'table_close') { const tk = tokens[j];
        if (tk.type === 'tr_open') cur = []; else if (tk.type === 'tr_close') rows.push(cur);
        else if ((tk.type === 'th_open' || tk.type === 'td_open')) { const inl = tokens[j + 1]; cur.push(inl && inl.type === 'inline' ? inl.content : ''); }
        j++; }
      renderTable(rows); i = j; break; }
    default: break;
  }
}

// footer page numbers
const range = doc.bufferedPageRange();
for (let p = range.start; p < range.start + range.count; p++) {
  doc.switchToPage(p);
  doc.font(FONTS.body).fontSize(8).fillColor('#8a97a5');
  doc.text(`${INPUT.split('/').pop()}  ·  page ${p + 1} of ${range.count}`, doc.page.margins.left, doc.page.height - 40, { width: PAGE_W, align: 'center' });
}
doc.end();
console.log('wrote', OUTPUT);
