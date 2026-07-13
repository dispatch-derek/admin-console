# F-005 Per-Customer Feature Toggle Console — Design

Spec: `specs/F-005-per-customer-feature-toggle-console.md` (Draft rev 3 — all OQs
REQ-F005-043..052 RATIFIED at their recommended defaults; treated as requirements).
Parent conventions: `specs/admin-console.md` v1 rev 7; `docs/design/00–05`, `03-data-models.md`,
`07-F002-baseline-prompt.md`. Design-system contracts: `docs/design/F-001/01-component-contracts.md`.

This design is deliberately thin. F-005 is **one migration, one repository, one small pure
resolver, one service, one route file, one catalog loader, and one web feature folder**. It reuses
the established store / event / audit / design-system machinery verbatim and adds **no engine path**
(REQ-F005-003). Unlike F-002/F-003 there is no anti-corruption layer work at all: no engine read, no
verify-after-write against the engine, no fan-out, no confirm-token. The single genuinely new piece
is a **deployment-provided catalog manifest** loaded at startup (REQ-F005-044).

**Simplicity tradeoffs chosen (stated explicitly):**
- No adapter, no background worker, no batch write route — each toggle is one synchronous upsert
  (immediate-apply, REQ-F005-022/046).
- No optimistic-concurrency token: last-writer-wins on the single-tenant SQLite store
  (REQ-F005-021, parent OQ-6).
- No new bus/relay: reuse `emitAdminEvent` + outbox; the new event lands `__unkeyed__` on F-004
  (REQ-F005-052) with **no F-004 change this revision**.
- No "retired features" view, no cross-tenant identifier, no central plane (REQ-F005-011/049/050).
- The pure resolver is a two-line `override ?? default` — kept as its own tested function only
  because REQ-F005-017/020/025 flag it as the highest divergence-risk predicate, not because it
  needs an abstraction.

---

## 1. Module decomposition

### 1.1 New / edited BFF files

| File | Responsibility (one sentence) | Implements |
|---|---|---|
| `bff/src/store/db.ts` (edit) | Add the `feature_toggle_state` table to the idempotent `migrate()` block. | REQ-F005-012 |
| `bff/src/store/repositories/feature-toggle.repo.ts` (new) | Row-level reads/writes of override rows: `get`, `list`, `upsert`, `delete` (append-only audit lives elsewhere). | REQ-F005-012/014/021/023 |
| `bff/src/feature-catalog/catalog.ts` (new) | Load the deployment-provided manifest at startup, validate/normalize each entry, **coerce missing `defaultEnabled` to `false`**, expose `getCatalog()` / `findEntry(featureKey)`; catalog is read-only in-memory, never persisted. | REQ-F005-016/044/024/049 |
| `bff/src/feature-catalog/resolve.ts` (new) | Pure resolver `resolveEffective(defaultEnabled, overrideRow)` → `{ enabled, hasOverride }` = `override ?? default`; plus the orphan/active partition helper. | REQ-F005-017/018/020/025 |
| `bff/src/services/feature-toggle.service.ts` (new) | Owns the per-call chain for the three routes: list (join catalog+overrides, counts, label), set (validate, store-confirmed upsert, conditional event, audit), clear (idempotent delete, conditional event, audit). | REQ-F005-019/021/023/027/030/037/038 |
| `bff/src/routes/feature-toggle.routes.ts` (new) | Thin Fastify handlers for the three §7.2 routes; **percent-decode `:featureKey` once**, parse body, resolve actor, delegate to the service. | REQ-F005-028/029/030, §7.2 |
| `bff/src/types/product-types.ts` (edit) | Add `FeatureCatalogEntry`, `FeatureToggle`, `FeatureToggleListView` (§7.1 verbatim). | REQ-F005-016 (parent REQ-025) |
| `bff/src/events/catalog.ts` (edit) | Add `'admin.feature_toggle.changed'` to `AdminEventName` and its payload type. | REQ-F005-037 |
| `bff/src/config.ts` (edit) | Add `featureCatalogPath` (manifest location) and `customerLabel` (config value, fallback to instance origin). | REQ-F005-044/048 |
| `bff/src/index.ts` (edit) | Register `featureToggleRoutes` in `buildApp()`; trigger catalog load at startup. | REQ-F005-029, §7.2 |

**Catalog load timing.** `catalog.ts` loads and validates the manifest at module init / first
`buildApp()` (mirroring how `db.ts` runs `migrate()` at load and `config.ts` reads env at load). A
malformed or missing manifest is handled per REQ-F005-024 as an **empty catalog** (see §7 flag —
this is the one place the spec's "deployment concern" leaves fail-open vs fail-closed unstated).

### 1.2 New web files (`web/src/features/featureToggles/`)

Follows `docs/design/05-web-architecture.md`; reuses `PageHeader`, `ErrorBanner`, the design-system
`Toggle` (`role="switch"`, `onChange(next:boolean)`), and the existing loading/empty scaffolding.
Wires into the existing **"Customer-wide"** sidebar section in `web/src/App.tsx` (which already hosts
`baseline`), adding a `featureToggles` `View` + nav item + `PAGE_META` entry.

| File | Responsibility | Implements |
|---|---|---|
| `FeatureTogglesPage.tsx` | Stateful shell: fetches the list view, renders the customer label, roster, loading state, first-class empty state; owns the confirm→set/clear flow and success/failure reflection. | REQ-F005-031/035/036/024/027 |
| `FeatureToggleRow.tsx` | One feature row: design-system `Toggle` labeled by `displayName`/`description`, effective state + provenance (operator-set vs default) encoded with text/icon **not color alone**. | REQ-F005-032/033/020 |
| `ToggleConfirm.tsx` | Lightweight (non-typed) confirmation naming the feature + customer/install and the become-available/withheld consequence; focus moved in on open, returned to trigger on close. | REQ-F005-034/042/047 |
| `EmptyFeaturesState.tsx` | First-class empty state ("No features are defined for this install yet"); not an error. | REQ-F005-024/036 |
| `web/src/api/client.ts` + `web/src/api/types.ts` (edit) | Add `getFeatureToggles`, `putFeatureToggle`, `clearFeatureToggleOverride`, mirror the three product types; **percent-encode the `featureKey`** path segment. | REQ-F005-028/029 |

Web is engine-free: only product `/api/*` routes and product field names (parent REQ-021a;
REQ-F005-029/039).

---

## 2. Data model / migration plan

One table, added to `bff/src/store/db.ts` `migrate()` inside the existing `db.exec` block using the
established `CREATE TABLE IF NOT EXISTS` idempotent style (no external migration runner). No additive
`PRAGMA table_info` column is needed (all columns are in the initial CREATE).

### 2.1 `feature_toggle_state` (one row per operator-set override — REQ-F005-012)

```sql
CREATE TABLE IF NOT EXISTS feature_toggle_state (
  feature_key TEXT PRIMARY KEY,   -- stable global catalog featureKey (REQ-F005-016/015/018); opaque, matched literally
  enabled     INTEGER NOT NULL,   -- 0/1 explicit operator override (REQ-F005-012)
  updated_at  TEXT NOT NULL,      -- ISO-8601 of the override write
  updated_by  TEXT NOT NULL       -- staff id (parent REQ-029c actor)
);
```

**Invariants & choices:**
- **Override rows are the only persisted state.** The catalog (features, display metadata, defaults)
  is NEVER copied into the store as authoritative; effective state is always computed from the
  *current* catalog + override, never a cached snapshot (REQ-F005-013).
- **PK = the stable global `featureKey`**, not an install-local surrogate — the forward-compat
  measure so this install's set is a clean single-tenant slice (REQ-F005-015/050). No tenant id.
- **Last-writer-wins:** the repo uses `INSERT … ON CONFLICT(feature_key) DO UPDATE` (upsert),
  mirroring `baseline.repo.ts`. Each PUT is its own committed transaction; no concurrency token
  (REQ-F005-021).
- **Orphans retained, not deleted.** An override whose `feature_key` is absent from the current
  catalog is retained in the store but excluded from the active list and every count
  (REQ-F005-014/025). No delete-on-catalog-change path exists.
- **History is NOT in this table.** The complete operator-action history lives in the existing
  append-only `audit_log` (parent REQ-093/093a) via `recordAudit`; the event bus carries
  effective-state deltas only (REQ-F005-038). No dedicated history table is built (REQ-F005-051).

### 2.2 Repository interface (`feature-toggle.repo.ts`)

```ts
export interface FeatureToggleRow {
  feature_key: string;
  enabled: number;          // 0 | 1
  updated_at: string;
  updated_by: string;
}

export const featureToggleRepo = {
  get(featureKey: string): FeatureToggleRow | undefined;   // no row → undefined (= no override)
  list(): FeatureToggleRow[];                              // all override rows (incl. orphans)
  upsert(featureKey: string, enabled: boolean, updatedBy: string, ts: string): void; // LWW upsert
  delete(featureKey: string): void;                        // clear override; no-op if absent
};
```

Persistence: reuse the existing `better-sqlite3` handle + WAL DB — no new store, no engine data.
Durability across restart is inherited from SQLite (REQ-F005-041).

---

## 3. Interface contracts — the divergence-prone pieces (pinned)

Per the spec self-check (§ end of spec), the highest divergence risk is effective-state resolution,
provenance, and orphan/new-feature handling. All three live in `feature-catalog/resolve.ts`, pure and
unit-testable.

```ts
// REQ-F005-017 — deterministic: override ALWAYS wins; a later default change never overrides an
// existing override. A feature present in catalog with no override row → { enabled: D, hasOverride:false }.
export function resolveEffective(
  defaultEnabled: boolean,
  overrideRow: FeatureToggleRow | undefined,
): { enabled: boolean; hasOverride: boolean } {
  if (overrideRow) return { enabled: overrideRow.enabled === 1, hasOverride: true };
  return { enabled: defaultEnabled, hasOverride: false };
}

// REQ-F005-018/025 — an override row is ACTIVE iff its key is in the current catalog, else ORPHAN.
// Orphans are excluded from features[] and every count; their rows are NOT deleted (REQ-F005-014).
```

**List assembly (REQ-F005-019, counts basis pinned):** iterate the **catalog** (the source of the
feature set); for each entry join its override row (if any) and `resolveEffective`. Orphan overrides
(keys not in the catalog) are never emitted. `counts` are computed on the **effective** state over
exactly `features[]`: `enabled` = count of effective-true, `disabled` = effective-false,
`total = enabled + disabled = features.length`. An empty catalog → `features: []`,
`counts: {0,0,0}`, and the empty state renders (REQ-F005-024).

**`featureKey` path-segment contract (REQ-F005-028, pinned):**
- Web client **percent-encodes** the single path segment (RFC 3986; e.g. `a/b c` → `a%2Fb%20c`).
- The route handler **percent-decodes exactly once** (`decodeURIComponent`) before use, then matches
  the decoded string **literally** (byte-for-byte, no normalization, no case folding) against catalog
  keys and override rows.
- A segment that is not valid percent-encoding → **400** ("malformed feature key"). A well-formed
  segment decoding to a key absent from the catalog → **404** ("unknown feature"), not a routing error.
  *(Note: Fastify decodes path params by default; the handler MUST decode-once deliberately and reject
  malformed sequences with 400 rather than let the framework 500 — see §7 flag.)*

---

## 4. API layer plan (matches §7.2 exactly — 3 routes)

`bff/src/routes/feature-toggle.routes.ts`, all under `/api`, all staff-session-guarded (parent
REQ-012, enforced by the global session guard already in `buildApp()`), error bodies `{ message }`
(parent REQ-097a). Thin handlers delegating to `feature-toggle.service.ts`. **No engine call
participates in any route** (REQ-F005-003/029).

| Method / path | Req body | Resp | Store call(s) | Mutates → event |
|---|---|---|---|---|
| `GET /api/feature-toggles` | — | `FeatureToggleListView` | catalog read + `repo.list()` | no (REQ-F005-019) |
| `PUT /api/feature-toggles/:featureKey` | `{ enabled: boolean }` | `FeatureToggle` | `repo.upsert` | store → `admin.feature_toggle.changed` **only when effective state changes** (REQ-F005-021/037) |
| `DELETE /api/feature-toggles/:featureKey/override` | — | `FeatureToggle` | `repo.delete` | store → `admin.feature_toggle.changed` **only when effective state changes** (REQ-F005-023/037) |

**Validation / status codes to pin (REQ-F005-030):**
- `PUT` body omits `enabled` or `enabled` is not a JSON boolean → **400** ("enabled must be true or false").
- `PUT`/`DELETE` for a `:featureKey` **not present in the current catalog** → **404** ("unknown feature");
  never creates state for an undeclared feature (REQ-F005-008).
- Malformed percent-encoding in `:featureKey` → **400** ("malformed feature key") (REQ-F005-028).
- Store write that cannot be confirmed (read-back ≠ intended) → **500** ("could not confirm the change
  was saved") and **no event** (REQ-F005-021/037).
- Unauthenticated → **401** (parent REQ-012).

**`DELETE` on a catalog-present feature with no override row (REQ-F005-023, pinned):** idempotent
**200** success — returns `FeatureToggle` with `hasOverride:false` and the default effective state,
deletes nothing, emits **no** event, records an **accepted-clear** audit entry. This is explicitly
**not** a 404 (404 is reserved for a key absent from the catalog).

### 4.1 Service contract (`feature-toggle.service.ts`)

```ts
export function listFeatureToggles(): FeatureToggleListView;          // GET
export function setFeatureToggle(                                     // PUT
  actorId: string, featureKey: string, enabled: unknown,
): FeatureToggle;                                                     // throws AppError(400|404|500)
export function clearFeatureToggle(                                   // DELETE
  actorId: string, featureKey: string,
): FeatureToggle;                                                     // throws AppError(404)
```

All three are synchronous (no engine `await`), consistent with the store-only nature of the feature.

### 4.2 Event catalog addition (`events/catalog.ts`)

Add `'admin.feature_toggle.changed'` to `AdminEventName` and:

```ts
// admin.feature_toggle.changed (REQ-F005-037). Emitted ONLY after a store-confirmed write whose
// EFFECTIVE state actually changes. Store write, not an engine mutation → verified is store-confirmed
// (scalar) true (deviation mirrors F-002 REQ-F002-035 / REQ-F002-035 M5, REQ-F005-021).
export interface FeatureToggleChangedPayload {
  enabled: boolean;      // new effective state
  previous: boolean;     // prior effective state
  hasOverride: boolean;  // whether an override row exists after the write
}
// target: { featureKey }.  Ordering: falls to F-004 __unkeyed__ (REQ-F005-052) — see §6.
```

---

## 5. Data flow (main scenarios, textual)

**List (`GET /api/feature-toggles`):** load `getCatalog()` (in-memory) + `repo.list()`; for each
catalog entry, `resolveEffective(entry.defaultEnabled, overrideByKey[entry.featureKey])`; assemble
`FeatureToggle` rows (with `updatedAt`/`updatedBy` from the override or null); orphan overrides
excluded; compute effective counts; attach `customerLabel` from config. Zero writes.

**Set (`PUT`):** decode key once (400 on malformed); `findEntry` (404 if absent); validate `enabled`
is boolean (400); read prior override → compute prior effective; `repo.upsert(...)`; **read the row
back and confirm it equals the intended value** (store-confirm; 500 + no event if not, REQ-F005-021);
compute new effective; **audit every accepted set** (actor, action=route, target={featureKey}, new
state, hasOverride, verified:true, outcome) (REQ-F005-038); **emit `admin.feature_toggle.changed`
only if new effective ≠ prior effective** (REQ-F005-037) — an effective-unchanged write (e.g. PUT
equal to existing value, or PUT creating an override equal to the default) still upserts + refreshes
`updated_at`/`updated_by` + audits but emits no event. Return `FeatureToggle`. Zero engine calls.

**Clear (`DELETE .../override`):** decode key once; `findEntry` (404 if absent from catalog); read
prior override → prior effective; if an override exists, compute default effective; `repo.delete(key)`;
if none existed, delete nothing (idempotent 200); **audit the accepted clear** (including the
no-override and effective-unchanged cases, REQ-F005-023/038); **emit only if effective state changed**
(REQ-F005-037). Return `FeatureToggle` with `hasOverride:false` + default effective state.

**Empty catalog:** `GET` returns `{ customerLabel, features: [], counts: {0,0,0} }`; the web renders
`EmptyFeaturesState`, not an error (REQ-F005-024/036).

**Web set/clear:** row `Toggle.onChange(next)` → `ToggleConfirm` (names feature + customer +
consequence) → on confirm, call client with the **percent-encoded** key → on success reflect new
effective state + provenance; on failure render the BFF `{ message }` verbatim via `ErrorBanner` and
**leave the row at its prior state** (no stranded optimistic "saved") (REQ-F005-034/035).

---

## 6. Cross-spec touchpoint (F-004)

`admin.feature_toggle.*` is a **new (seventh) event family** not covered by F-004 §3's ordering-key
derivation (which reads `target.id`/`target.workspace`/`target.keys`). Absent an added rule,
feature-toggle events fall to F-004's reserved **`__unkeyed__`** key = independent delivery, no
per-key ordering. Per **REQ-F005-052 (RATIFIED)** this is **accepted for this revision** and **F-004
§3 is NOT extended now** — no F-004 change is required by F-005. Each event carries `previous` +
`enabled` so a late/duplicate delivery is self-describing, and a billing/history consumer reconstructs
state from the audit log or a fresh read (which do not depend on bus ordering). Deferred/untriggered:
if per-`featureKey` ordering is later required, extending F-004 §3 (e.g. `feature:<target.featureKey>`)
MUST be done in F-004, not assumed here.

---

## 7. Risks & flagged conflicts (spec ↔ codebase)

**Flagged conflicts (surfaced, not resolved — per instruction):**

1. **Manifest load failure posture is unstated (fail-open vs fail-closed).** REQ-F005-044 pins a
   deployment-provided manifest and REQ-F005-024 pins that an *empty* catalog is a valid, non-error
   state. The spec does **not** say what happens when the manifest path is configured but the file is
   **missing/malformed/unreadable** at startup. Two defensible readings: (a) treat as empty catalog
   (fail-open, consistent with the "catalog may be empty today" posture) or (b) fail startup like a
   required-config error (consistent with `config.ts`'s `requireEnv` throw-at-load convention). These
   genuinely conflict; the implementer must pick one. Recommendation to raise, not decide here:
   fail-open to empty-with-a-logged-warning matches REQ-F005-024's intent, but it diverges from the
   codebase's fail-closed config convention — hence flagged.

2. **`featureKey` decode-once vs Fastify's automatic param decoding (REQ-F005-028).** Fastify already
   percent-decodes route params once. REQ-F005-028 mandates decode-**exactly-once** + a **400 on
   malformed** encoding. Relying on the framework's implicit decode risks either a double-decode (if
   the handler decodes again) or a framework-level 500/route-miss on a malformed sequence instead of
   the required 400. The handler must be written to own this contract explicitly (validate the raw
   segment / catch the decode error → 400) rather than lean on default behavior. Flagged because the
   safe implementation is non-obvious and easy to get subtly wrong.

3. **`__unkeyed__` ordering (REQ-F005-052)** — not a conflict, an accepted limitation: two changes to
   the same `featureKey` are not guaranteed in-order on the bus. Explicitly ratified as acceptable; the
   audit log is the ordered source of truth.

**Risks / parts most likely to need revision:**
- **Effective-state resolution & provenance (REQ-F005-017/020/025)** — the spec-flagged
  highest-divergence predicate; pinned in §3 to `override ?? default` + the orphan partition, with the
  exact count basis. Most likely to need a focused unit-test pass.
- **Event suppression vs. always-audit (REQ-F005-037/038)** — the load-bearing subtlety that an
  effective-state-unchanged write still upserts + audits but emits **no** event (and is NOT a
  write-nothing no-op). Easy to conflate; pinned in §5.
- **Catalog source mechanism (REQ-F005-044)** — the manifest format/location is a deployment concern
  adopted provisionally; if the shared codebase later ships a runtime registration mechanism, only
  `feature-catalog/catalog.ts` changes (the resolver, store, routes, and web are insulated).
- **Store-confirm on a store write (REQ-F005-021)** — a light read-back, not an engine
  verify-after-write; mirrors F-002's baseline-store `verified:true` deviation from the engine-oriented
  parent REQ-028. Keep it a store read-back, not an engine call.

---

## 8. Sequencing / dependency notes

Build order (each depends on the prior):
1. `db.ts` migration (`feature_toggle_state`) — repos prepare statements eagerly and throw on a
   missing table.
2. `feature-catalog/catalog.ts` + `resolve.ts` (pure/loader) — no DB dependency; unit-testable in
   parallel with (1).
3. `feature-toggle.repo.ts` — depends on (1).
4. `product-types.ts` + `events/catalog.ts` additions + `config.ts` additions — no runtime deps.
5. `feature-toggle.service.ts` — depends on (2)(3)(4) + existing `emitter`, `recordAudit`.
6. `feature-toggle.routes.ts` + register in `index.ts` — depends on (5).
7. web feature folder + `App.tsx` nav wiring + `api/client.ts`/`types.ts` — depends on the product
   types (4) and routes (6).
