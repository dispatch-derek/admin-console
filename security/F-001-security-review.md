# Security Review — F-001 "Adhere to a Design System"

- Date: 2026-07-10
- Branch: `feature/F-001-design-system`
- Reviewer: security-reviewer (read-only on source/tests)
- Change set: working tree vs `main` (nothing committed). Frontend-only (`web/`).

## Scope reviewed

- All 28 modified tracked files (`git diff main`), focused on components rendering BFF data.
- New untracked trees: `web/src/design-system/**` (11 recreated components, tokens, barrel),
  `web/src/bridge/**`, `web/src/test/fsScan.ts`, gate/inventory tests under `web/tests/**`,
  `web/.oxlintrc.json`, `web/.stylelintrc.json`, `web/eslint.config.js`.
- Dependency changes: `web/package.json`, `web/package-lock.json`.
- Priority focus areas from the task brief: custody boundary / engine leakage, secret handling,
  dependency CVEs, XSS/injection.

## Scanners run

- `npm audit` (web): 0 vulnerabilities (info/low/moderate/high/critical all 0; 383 deps resolved).
- `vitest run src/leakage.test.ts src/components/SetNotSetBadge.test.tsx`: 203 passed.
- Manual grep sweeps for: `dangerouslySetInnerHTML`, `innerHTML`, `__html`, `eval(`, `new Function`,
  prop spreading (`...props`/`...rest`), `localStorage`/`sessionStorage`/`document.cookie`,
  `window.*`, `postMessage`, `target="_blank"`, absolute `http(s)://` URLs, `process.env`/
  `import.meta.env`, and the `/v1/` + engine-identifier fragments.

## Findings

### 1. Custody boundary / engine leakage (parent REQ-013/021/021a/026) — PASS

- `web/src/leakage.test.ts` scans all non-test `web/src/**` `.ts(x)` for the full 186-key engine
  env-key whitelist, the 6 read-only system flags, `chatProvider`, `update-env`, `/v1/`, `/api/v1`,
  and any absolute `http(s)://` URL. It passes on the current tree.
- The new DS/bridge/token strings I inspected are product/design vocabulary only (color/spacing
  token names, component names, `Plus Jakarta Sans`, icon names). None matches an engine identifier,
  `/v1/*` path, engine URL, or engine field name.
- `web/src/api/client.ts`: every call uses a relative `/api/*` path with `credentials: 'same-origin'`;
  path segments are `encodeURIComponent`-wrapped. The browser never holds the upstream key.
- The one sanctioned exception, `RawEnvEditor`, derives its key list at runtime from `getRawEnv()`
  and never hardcodes engine key names (`web/src/features/raweditor/RawEnvEditor.tsx:32-49,91-116`).

### 2. Secret handling (parent REQ-060/061) — PASS

- `web/src/components/SetNotSetBadge.tsx:11-13`: renders only the literal `set`/`not set` via a DS
  `Badge` tone; the secret value is never a prop and never rendered.
- `web/src/features/settings/SecretField.tsx:20-34`: DS `Input` with `type="password"` and
  `autoComplete="new-password"`; it carries only the pending-overwrite text (empty = no change) and
  the boolean `set`. No logging, no echo, no reveal of the stored value.
- `web/src/features/raweditor/RawEnvEditor.tsx:98-104`: secret entries render `SetNotSetBadge`
  (set/not-set) and never the value; write inputs for secret keys use `type="password"`.
- `web/src/features/diagnostics/DiagnosticsPage.tsx:58-70`: env-dump values are masked upstream and
  displayed as-is via JSX text (`{String(value)}` in `<code>`); no client-side unmasking.

### 3. XSS / injection surface — PASS

- No `dangerouslySetInnerHTML`, `innerHTML`, `__html`, `eval`, or `new Function` anywhere in
  production `web/src`.
- `web/src/components/ErrorBanner.tsx:8-14`: renders the BFF `{ message }` as JSX text inside a
  `role="alert"` div — React auto-escapes; no HTML injection path. Same verbatim-text pattern holds
  for all migrated call sites that surface BFF data (Diagnostics, RawEnvEditor, confirm dialogs).
- No DS component uses prop spreading onto DOM elements (`{...props}`/`{...rest}` absent), so there is
  no prototype-pollution / arbitrary-attribute injection via prop passthrough. Props are destructured
  and wired explicitly (e.g. `Input.tsx`, `Modal.tsx`).
- `Modal.tsx` inlines a static SVG close icon (fixed markup, no data interpolation). No `target="_blank"`
  links, no `window`/`postMessage` usage.

### 4. Dependencies & supply chain — PASS

- `npm audit`: clean (0 findings).
- New runtime dep `@phosphor-icons/react` (declared `^2.1.7`, lockfile-pinned to `2.1.10`): a widely
  used, maintained icon library; no known advisory. Added as a `dependencies` (runtime) entry, which
  is appropriate since it ships in the bundle.
- New devDeps `oxlint` (^1.14.0), `stylelint` (^16.10.0): dev/build-time only, no runtime exposure.

### 5. Configuration — PASS (no security-relevant change)

- `eslint.config.js` additions are `no-restricted-syntax` lint rules enforcing the design-token floor
  (no raw hex/px/off-system font). No security impact; if anything they add a build-time gate.
- `main.tsx` adds two CSS imports (token layer + prefers-color-scheme bridge). No logic change.

## Not assessed

- `bff/` / engine / API / routes / data model: out of scope for F-001 (frontend-only migration); not
  reviewed here. The custody guarantee depends on the BFF continuing to inject the upstream key and
  mask secrets/env-dump server-side — verified only at the web boundary, not re-verified server-side.
- Full E2E behavioral equivalence of the migration (a QA concern, not security).
- semgrep/eslint-security-plugin were not run (not installed); manual review + the project's own
  leakage/gate test suite were used instead.

## Verdict

PASS

No Critical/High/Medium/Low findings. The migration is behavior-preserving from a security
standpoint: the custody boundary holds (relative `/api/*` only, no engine identifiers), secrets are
never rendered or logged, all BFF data is rendered as auto-escaped JSX text with no new HTML-injection
or code-execution sink, no unsafe prop spreading was introduced, and `npm audit` is clean.
