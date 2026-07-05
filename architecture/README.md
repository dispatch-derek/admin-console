# Architecture docs

`architecture-explained.md` is the **living source of truth** for this app's logical and
physical architecture. Edit it in the same change that alters the architecture.

`architecture-explained.pdf` is a **generated artifact** — do not hand-edit it. Regenerate it
after editing the Markdown:

```bash
# one-time (in this dir or anywhere with node ≥18):
npm i pdfkit markdown-it
# regenerate:
node build-pdf.mjs architecture-explained.md architecture-explained.pdf
```

`build-pdf.mjs` is a browser-free renderer (pdfkit + markdown-it). It embeds Ubuntu / Ubuntu
Mono TTFs when present so box-drawing diagrams render; otherwise it falls back to the
standard PDF fonts and sanitizes non-Latin glyphs to ASCII.
