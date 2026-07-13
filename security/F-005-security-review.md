# Security Review — F-005 "Per-Customer Feature Toggle Console"

- Date: 2026-07-12
- Branch: `feature/F-005-per-customer-feature-toggles`
- Reviewer: security-reviewer (read-only on source/tests)
- Change set: full working-tree diff vs `HEAD` (nothing committed) + untracked F-005 trees.
- Spec: `specs/F-005-per-customer-feature-toggle-console.md`
- Re-review: 2026-07-12 — Finding 1 verified **RESOLVED** (Derek ruling → REQ-F005-060, spec rev 7);
  verdict raised to **PASS**.

## Scope reviewed

- BFF routes: `bff/src/routes/feature-toggle.routes.ts`
- Service: `bff/src/services/feature-toggle.service.ts`
- Repository: `bff/src/store/repositories/feature-toggle.repo.ts`
- Catalog loader/resolver: `bff/src/feature-catalog/catalog.ts`, `bff/src/feature-catalog/resolve.ts`
- Schema migration + rollback: `bff/src/store/db.ts`
- Audit change: `bff/src/audit/audit.ts`
- Event catalog: `bff/src/events/catalog.ts`
- Config: `bff/src/config.ts`
- Wiring: `bff/src/index.ts`, `bff/src/types/product-types.ts`
- Auth: `bff/src/server/session-guard.ts` (re-verified guard covers the new routes)
- Web: `web/src/features/featureToggles/**`, `web/src/api/client.ts`, `web/src/api/types.ts`,
  `web/src/App.tsx`, DS `Toggle.tsx`

## Scanners run

- `npm audit --omit=dev` (bff production deps): **0 vulnerabilities**.
- Manual grep sweeps: `dangerouslySetInnerHTML` / `innerHTML` / `eval(` / `new Function` / `__html`
  (none in F-005 web/DS code); secrets (`password|secret|apikey|token|private_key`) in new BFF
  files (no hits); `ANYTHINGLLM_BASE_URL` / `baseUrl` cross-reference sweep.
- Manual data-flow trace of the opaque `featureKey` param (source → SQL/audit/render sinks) and the
  `enabled` body value.
- semgrep/eslint-security were not installed; manual review used in their place.

## Findings

### 1. [Low] Engine base URL leaks into the product API payload and DOM via the `customerLabel` fallback — RESOLVED (2026-07-12)

**Status: RESOLVED.** Ruling by Derek, recorded as **REQ-F005-060** (spec rev 7, §6.3), deprecating
REQ-F005-048's origin-fallback clause. Fix and coverage verified in source below.

**Fix verified (`bff/src/config.ts:61`):**
```
customerLabel: process.env['CUSTOMER_LABEL'] || 'this install',
```
The engine-URL fallback is gone; the fallback is now a fixed neutral literal, never any
engine-derived value. I re-traced the whole label path and confirmed no other engine-derived value
feeds it: `config.customerLabel` is the sole source read by `listFeatureToggles()`
(`bff/src/services/feature-toggle.service.ts:61`), and `anythingLLMBaseUrl` (config.ts:30/33) no
longer touches the label. The config comment now explicitly names `ANYTHINGLLM_BASE_URL / origin /
host / port` as forbidden fallbacks (REQ-F005-003/039 take precedence).

**Test coverage verified adequate:**
- `bff/test/config.test.ts:210-234` (REQ-F005-060 block): asserts the fallback equals `"this install"`
  for both unset and empty `CUSTOMER_LABEL`, plus inverse assertions (`.not.toBe(<base URL>)`,
  `.not.toContain('engine.local')`) that pin it to *not* being the engine URL — the exact regression
  class of this finding — and that an explicit `CUSTOMER_LABEL` takes precedence.
- `tests/e2e/tests/feature-toggles-leakage.spec.ts:127-167`: my original remediation ask — extend the
  leakage test to assert on the **runtime** `customerLabel` value, not just the compiled bundle string —
  is **satisfied**. It renders the page and confirm dialog and asserts (a) the fallback literal appears
  verbatim in both the label and the dialog consequence copy, (b) no absolute-URL-shaped text or the
  literal `ANYTHINGLLM_BASE_URL` appears anywhere in the DOM, and (c) a non-vacuousness/detectability
  test that deliberately mocks a regressed engine-origin `customerLabel` and proves the web layer
  applies no client-side masking — so a future BFF-side regression would surface unfiltered. This
  closes the coverage gap I flagged (the prior bundle-only scan structurally could not catch a runtime
  payload value).

**Remediation suggestion — CLOSED.** Nothing outstanding. Original finding detail retained below for the
record.

<details><summary>Original finding (pre-fix, for the record)</summary>

- **Location (pre-fix):** `bff/src/config.ts:59` —
  `customerLabel: process.env['CUSTOMER_LABEL'] || requireEnv('ANYTHINGLLM_BASE_URL').replace(/\/$/, '')`
- **Flow:** `config.customerLabel` (fell back to the engine `ANYTHINGLLM_BASE_URL` value)
  → `listFeatureToggles()` returned it as `customerLabel` → `GET /api/feature-toggles` response
  → rendered verbatim in the DOM at `FeatureTogglesPage.tsx` ("Acting on: …") and the `ToggleConfirm.tsx`
  consequence copy.
- **Impact:** When `CUSTOMER_LABEL` was unset (the default), the engine base URL (internal hostname/port)
  was served to the browser and shown to authenticated staff — internal-topology info disclosure
  contradicting REQ-F005-003 ("no F-005 code path references `ANYTHINGLLM_BASE_URL`") and REQ-F005-039
  ("engine-path never appears in an F-005 payload or bundle"). The bundle-scan leakage test could not
  catch it because the leak was a runtime response value, not a compiled-in string.
- **Severity:** Low — exposure to already-authenticated staff, base URL is not a credential, no
  injection/RCE vector; but high likelihood (default path) and an explicit custody-boundary violation.

</details>

## Areas reviewed and found clean

- **SQL injection (repo):** `bff/src/store/repositories/feature-toggle.repo.ts` — all four statements
  are `better-sqlite3` prepared statements with `?`/named parameters; `feature_key` is bound, never
  concatenated. No injection path. PK is plain `TEXT` (byte-for-byte, no `COLLATE NOCASE`), consistent
  with the opaque-key contract.
- **Input validation / `featureKey` handling:** The opaque key is decoded exactly once by Fastify's
  router, matched byte-for-byte against the in-memory catalog (`findEntry`), and an unknown key is
  rejected `404` before any write (`setFeatureToggle`/`clearFeatureToggle`). It is never used to build
  a filesystem path, shell command, or SQL string, so no path-traversal / command-injection / injection
  sink exists. `enabled` is strictly `typeof === 'boolean'` (else `400` + failure audit).
- **AuthN/AuthZ:** All three routes register under the global `onRequest` session guard
  (`bff/src/server/session-guard.ts`); none is in `PUBLIC_API_PATHS`. Each handler additionally calls
  `requireStaff()` (throws `401` when `req.staff` is null). Single-tenant model — no per-object
  authorization to bypass (any authenticated staff may toggle any feature, by design). `updatedBy`
  is taken from the server-side session (`actor.id`), not from the request body, so it cannot be spoofed.
- **Catalog loader (`catalog.ts`):** Reads a deployment-controlled env path (`FEATURE_CATALOG_MANIFEST_PATH`),
  not untrusted input — no user-driven path traversal. `JSON.parse` result is validated field-by-field
  into freshly constructed objects (no merge/assign of attacker keys), so no prototype-pollution sink;
  a `__proto__` featureKey would be an inert `Map` key. Fail-closed on a present-but-broken manifest
  (refuse to start), empty-catalog on unset/absent — correct posture. Error messages name the manifest
  path (server-side startup log only, not client-facing).
- **Audit change (`audit.ts`):** The new `string` target branch stores the opaque `featureKey`
  verbatim through the existing parameterized `auditRepo.insert` (INSERT-only, DB-trigger-protected).
  No new injection or format issue. `detail` still passes through `redactSecrets`. Both failure and
  success paths audit as required.
- **Secrets / crypto:** No hardcoded credentials, keys, or tokens in any new F-005 file. No new crypto,
  randomness, or comparison of secrets introduced. No sensitive values logged.
- **XSS (web):** All BFF-sourced strings (`displayName`, `description`, `category`, `updatedBy`,
  `updatedAt`, `customerLabel`) render as auto-escaped JSX text; no `dangerouslySetInnerHTML`,
  `innerHTML`, `eval`, or `new Function` anywhere in the F-005 web or DS `Toggle` changes. The DS
  `Toggle` change (`div`→`button`, `useId` label binding) introduces no injection surface.
- **Web client custody:** `web/src/api/client.ts` calls only relative `/api/feature-toggles*` paths;
  `featureKey` is `encodeURIComponent`-wrapped into the single path segment. No engine URL or API key
  crosses the boundary from the browser.
- **Migration / rollback (`db.ts`):** Additive `CREATE TABLE IF NOT EXISTS`; `rollbackF005` is a
  guarded `DROP ... IF EXISTS` scoped to the one table, with an explicit data-loss note. No security
  impact.
- **Dependencies:** No new runtime dependency added by F-005; `npm audit` clean.

## Not assessed

- Test suite / e2e suite were **not executed** (read-only review; findings are from static/manual
  analysis and `npm audit`). The behavioral correctness of the store-confirm and event-emission logic
  is a QA concern, not re-verified here. (The REQ-F005-060 fix and its assertions were verified by
  reading the test source, not by running it.)
- semgrep / eslint-security-plugin / bandit were not run (not installed / not applicable to a TS
  project); manual review substituted.
- The engine-side custody guarantee (that the BFF never exposes the API key) is inherited from the
  parent and was not re-verified beyond confirming F-005 makes no engine call.
- Rate-limiting / brute-force posture on the auth layer is parent-owned and out of F-005 scope.

## Verdict

**PASS**

The single Low finding (Finding 1: `customerLabel` engine-URL fallback) is **RESOLVED** — the fallback
is now the fixed neutral literal `'this install'` (REQ-F005-060), the label path draws from no other
engine-derived value, and coverage now includes both config-unit inverse assertions and a rendered-DOM
e2e leakage check with a non-vacuousness guard. No Critical/High/Medium findings remain. The core data
path — parameterized SQL, staff-guarded routes, strict boolean validation, byte-for-byte opaque-key
matching, auto-escaped rendering, no secrets, clean deps — is sound.
