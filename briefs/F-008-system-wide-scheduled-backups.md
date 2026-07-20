# F-008: System-wide backups on schedule

## Problem

The single-tenant deployment stack persists user-generated and system-generated
state to disk across three applications — admin-console (React web + Fastify BFF
+ SQLite), the AnythingLLM engine, and the sibling customer-web-app (same
architecture) — and there is currently no mechanism that captures that on-disk
state on a recurring basis. If the disk or host underlying a production
deployment is lost, corrupted, or wiped, there is no established path to return
the system to a functioning state, because nothing outside the live disk holds a
copy of what the apps have written.

The state at risk is concrete and interdependent:

- admin-console writes one SQLite file (WAL mode, 11 tables: staff,
  recovery_codes, sessions, login_challenges, workspace_map, audit_log,
  event_outbox, outbox_meta, baseline_prompt, workspace_baseline_state,
  feature_toggle_state), shared by two writer processes (the BFF and the F-004
  relay). It holds security-sensitive material: `staff.totp_secret` is
  AES-256-GCM-encrypted under an environment key (`SECRETS_ENC_KEY`) held
  *outside* the database, `recovery_codes` are hashed, `audit_log` is
  append-only via triggers, and `outbox_meta.epoch` is a UUID that transport
  delivery ids depend on (re-generating it causes consumers to see
  re-deliveries). A DB copy that is separated from its encryption key cannot
  decrypt its own TOTP secrets.
- customer-web-app writes one SQLite file (WAL, `wal_autocheckpoint=1`, 10
  tables via migrations 0001–0010: users, sessions, audit_log, topic_map,
  event_outbox, identity_map, branding, notices, addons, conversation_map).
- The AnythingLLM engine (per upstream docs) persists a storage directory
  containing its own SQLite DB, a LanceDB vector store, parsed document uploads,
  and vector-cache — none of which either app repo references or manages, as the
  engine is treated as a REST-only surface.
- A locally installed Ollama instance serves as an LLM provider that AnythingLLM
  depends on. Ollama persists its own on-disk state — downloaded/pulled models,
  any custom Modelfiles, and its configuration — outside all three app repos.
  The admin-console manages Ollama *settings* over the wire (base URL, model
  preference, token limit, keep-alive, auth token), but nothing manages or
  captures Ollama's persisted data.

Today the only recorded protection is manual: three migration runbooks
(F-002/F-004/F-005) instruct an operator to hand-copy a database file as a
precondition to destructive rollbacks. There is no recurring, unattended
capture, and no exercised path to restore the whole stack together.

## Affected Users

The people who bear the exposure of the current state:

- **The deployment operator / on-call owner** for each single-tenant
  installation, who would be responsible for recovering a system after a disk or
  host loss and currently has no automated artifact to recover from, only
  whatever manual file copies happened to be taken.
- **End users of the customer-web-app and admin-console** in a given tenant,
  whose accounts, sessions, audit history, workspace/topic mappings, branding,
  notices, add-ons, and conversation history live in the at-risk SQLite files.
- **Staff/admin users** whose TOTP enrollment and recovery codes live in the
  admin-console DB; a loss (or a restore that omits the external encryption key)
  affects their ability to authenticate.
- **Tenants relying on AnythingLLM-backed functionality**, whose uploaded
  documents and vector indexes live only in the engine's storage directory, and
  whose LLM capability depends on the locally installed Ollama instance's models
  and configuration being restorable alongside the rest of the stack.

Because the stack is single-tenant, "reach" here is a function of how many
tenant deployments run this stack rather than a share of accounts within one
tenant; the brief does not attempt to quantify that count — see Open Questions.

## Business Rationale

Falsifiable claims for the research agent to verify:

- **Claim:** No backup, restore, export, or snapshot capability exists in either
  the admin-console or customer-web-app repositories today. (Verifiable by code
  search across both repos; discovery pass found only unrelated referents.)
- **Claim:** A production go-to-market for this stack is gated on being able to
  recover from data loss, and the absence of an automated backup/restore
  capability is a production-readiness gap rather than a response to an
  observed incident. (Verifiable against go-to-market readiness criteria and the
  absence of any recorded loss event or drill in git history and docs.)
- **Claim:** The current sole safeguard is manual operator file-copies documented
  only as preconditions inside three migration runbooks, with no unattended
  mechanism. (Verifiable in docs/runbooks for F-002/F-004/F-005.)
- **Product-owner scope ruling, 2026-07-19, verbatim:** "This needs to cover
  admin-console, anythingllm, and the customer-web-app. Anything that these apps
  persist to disk that is user or app/system generated that would be needed to
  bring the system back to a functioning state after a disaster is what would be
  required of this feature/capability/procedure."
- **Product-owner scope addition, 2026-07-19, verbatim:** "there is also the
  locally installed Ollama that AnythingLLM depends on as a LLM provider. Ollama
  and its persisted data and models also needs to be part of this backup
  strategy."

## Timing

This is tied to go-to-market: the driver is production-readiness ahead of
shipping the stack to real deployments, not recovery from any event that has
already happened. To encode the timing honestly: **no loss event, corruption
event, or restore drill has occurred** — there is zero git-history or
documentation mention of any backup/restore/disaster incident. The pressure is
the go-to-market window and the judgment that a production system should not run
without a recovery path, not an active fire. The research agent should confirm
the specific go-to-market date/milestone this is gated against (see Open
Questions) rather than treat "tied to go-to-market" as a dated deadline on its
own.

## Existing Evidence

Leads for the research agent to re-verify (not established fact). Entries from
the 2026-07-19 discovery pass are tagged accordingly.

- `[agent-discovery 2026-07-19]` admin-console persistence: one SQLite file, WAL
  mode, 11 tables (staff, recovery_codes, sessions, login_challenges,
  workspace_map, audit_log, event_outbox, outbox_meta, baseline_prompt,
  workspace_baseline_state, feature_toggle_state); two writer processes (BFF +
  F-004 relay) share the file; path from env `DB_PATH`, default
  `data/console.db` (CWD-relative), git-ignored. Refs: `bff/src/store/db.ts:78-223`,
  `db-path.ts:18`.
- `[agent-discovery 2026-07-19]` Secret material at rest: `staff.totp_secret`
  AES-256-GCM-encrypted under env `SECRETS_ENC_KEY` (key held outside the DB);
  `recovery_codes` hashed; `outbox_meta.epoch` UUID that transport delivery ids
  depend on (re-generation causes consumer re-delivery); `audit_log` append-only
  via triggers. Refs: `bff/src/auth/crypto.ts:67`, `config.ts:68`,
  `db.ts:159-162`, `db.ts:340-348`.
- `[agent-discovery 2026-07-19]` Zero backup/restore/export/snapshot code or
  scripts across both admin-console and customer-web-app repos; all search hits
  were unrelated referents (auth recovery codes, focus-restore, relay backlog
  drain, vitest snapshot).
- `[agent-discovery 2026-07-19]` customer-web-app persistence: one SQLite file,
  WAL (`wal_autocheckpoint=1`), 10 tables via migrations 0001–0010 (users,
  sessions, audit_log, topic_map, event_outbox, identity_map, branding, notices,
  addons, conversation_map); default `data/customer.db`; no file-uploads path
  found (`branding.logo` is a TEXT reference, not a blob).
- `[agent-discovery 2026-07-19]` AnythingLLM engine (upstream docs): STORAGE_DIR
  holds `anythingllm.db` (SQLite), `lancedb` (vector DB), `documents` (parsed
  uploads), `vector-cache`, optionally `models`/`plugins`/`direct-uploads`.
  Upstream guidance: copy the whole storage directory; restore by replacing it;
  stop the app before archiving. Refs:
  https://docs.anythingllm.com/installation-desktop/storage +
  `server/storage/README.md`. Neither app repo references STORAGE_DIR or the
  engine's disk layout (engine treated as REST-only).
- `[agent-discovery 2026-07-19]` Deployment shape: no Dockerfile, compose file,
  volume declaration, systemd unit, or deploy script in either repo; DB paths
  default to CWD-relative. What "disk" means in production is undocumented
  in-repo.
- `[agent-discovery 2026-07-19]` Loss/drill history: zero git-history or docs
  mentions of backup/restore/disaster except three migration runbooks
  (F-002/F-004/F-005) requiring a manual operator file backup as a precondition
  to destructive rollbacks; no automated mechanism; no recorded loss events or
  drills.
- Ollama is a first-class managed dependency of the stack: the console maps
  `llm.ollama.baseUrl` / `.model` / `.tokenLimit` / `.keepAlive` / `.authToken`
  settings to engine env keys (`bff/src/engine/settings-map.ts:39-43`, verified
  2026-07-19) and ships an `OllamaModelSelect` settings control
  (`web/src/features/settings/OllamaModelSelect.tsx`). Neither repo references
  Ollama's on-disk storage.
- Lead (to verify): Ollama's default model/data store is the `~/.ollama`
  directory (models under `~/.ollama/models`, relocatable via the
  `OLLAMA_MODELS` env var) per upstream Ollama documentation/FAQ; pulled models
  are re-downloadable from the Ollama registry, which bears on whether they need
  capture or a re-provisioning manifest (see Open Questions).

## Proposed Direction

Non-binding starting point for later design/spec work: a scheduled, unattended
procedure that captures — for each of the three apps — the on-disk state
identified above and writes it to a durable destination separate from the live
disk, on a recurring cadence, with a matching restore path exercised well enough
to trust. For the SQLite files this likely means a consistency-safe snapshot
method appropriate to live WAL databases with concurrent writers (rather than a
naive file copy), and for the AnythingLLM engine it likely means capturing its
whole storage directory per upstream guidance. Ollama's persisted state (its
data directory, models, and any custom Modelfiles/configuration) is in scope per
the product-owner scope addition and must be covered either by capture or by a
deliberate re-provisioning strategy. The scope ruling implies the capture must
also account for the material needed to make a restored copy *usable* — e.g. the
external encryption key without which restored TOTP secrets are
undecryptable — though exactly what is included, where the scheduler runs, and
how backups are stored/encrypted are open (see Open Questions). Per product-owner
direction (2026-07-19), the spec writer should investigate whether **Apple
Business Manager for managing the device fleet and iCloud as the backup
destination** is a feasible and sensible mechanism for this capability — this is
an avenue to evaluate on its merits (platform assumptions, storage limits,
restore ergonomics, encryption posture), not a decided design. This paragraph is
deliberately not a design.

## Design Considerations

Reads from the ux-designer agent (2026-07-19); informs the human's later Effort and
Risk scores, does not set them.

- **complexity_read:** The Proposed Direction is overwhelmingly
  infrastructure/procedure; it can honestly ship with zero admin-console UI initially,
  and the UX surface is optional/deferrable — a cron-driven unattended job plus a
  documented restore runbook satisfies the direction as written. If/when an operator
  surface is grown, it decomposes into three surfaces of very different design weight,
  each with strong existing precedent: (1) *Backup status/history visibility* (most
  likely first, lightest): a read-only list of recent runs (timestamp, per-app result,
  destination, size/duration) — a near-clone of the DiagnosticsPage pattern (DS `Table`
  with `Badge`/`SyncStateChip`-style status pills and `ErrorBanner`); no novel
  interaction patterns, excellent design-system fit, minimal additive screens (one
  `SidebarItem`, one `PageHeader`). (2) *Schedule configuration* (medium, only if
  cadence must be operator-editable rather than config/env-fixed): a small
  cadence/retention/destination form; the `SettingsPage` data-driven form is a direct
  template, and changing a backup schedule plausibly qualifies as a §8-style dangerous
  op reusing the existing `DangerConfirm` gate — the open question is whether cadence
  is a UI concern at all vs. deployment config. (3) *Restore initiation/verification*
  (heaviest and most novel): restore is the one genuinely new interaction —
  destructive/overwriting, cross-app, dependent on out-of-band material (the external
  encryption key). The typed-token `DangerConfirm` + `AcknowledgeCheckbox` pattern
  covers the "irreversible confirm" shell, but a trustworthy restore flow
  (source/snapshot selection, key-availability precondition, progress, post-restore
  verification readout) has no existing analog and would be design-on-the-fly; most
  design-doc effort concentrates here, and it may reasonably be judged out of the
  initial console scope entirely (CLI/runbook-driven restore).
- **ux_risk_read:** Accessibility exposure: low for the status/schedule surfaces —
  they reuse components (`Table`, `Badge`, `Modal`, form controls) already carrying the
  project's focus-trap, `role`, and label conventions, so exposure is inherited rather
  than new; any long-running restore/backup progress indicator introduces a new
  live-status pattern (polling/streaming state) needing reduced-motion and `aria-live`
  consideration not yet present in these mostly-static pages. Reversibility is the
  dominant UX risk and it is asymmetric across surfaces: status/history is read-only
  (no risk); schedule config is re-editable; restore is inherently irreversible and
  data-overwriting — a mis-targeted or partial restore can destroy live state across
  three apps, and the encryption-key dependency means a restore can silently produce
  an unusable result (e.g. undecryptable TOTP secrets). The interaction must fail
  safe: explicit precondition checks before the action is offered, unmistakable naming
  of what gets overwritten, and honest post-restore verification rather than a bare
  success toast — restore UX carries materially more risk than everything else in the
  feature combined. Usability-testing needs: negligible for status/history; the
  restore flow, if built in-console, warrants operator walkthrough validation
  precisely because its failure mode is catastrophic and out-of-band-dependent; if
  restore stays CLI/runbook-only for v1, this testing need largely evaporates — itself
  a reason the console surface may be deferred.

## Out of Scope

- High-availability / live replication or failover.
- Point-in-time recovery beyond the granularity of scheduled snapshots.
- Multi-tenant backup concerns (the stack is single-tenant).

## Open Questions

- RPO/RTO targets for the stack — how much data loss and how much downtime are
  acceptable, which shape the required cadence and restore speed.
- Where the scheduler runs, given no deployment descriptors (Docker/compose/
  systemd/deploy scripts) exist in either repo and DB paths are CWD-relative.
- Consistency strategy for live SQLite WAL files with two concurrent writers
  (admin-console): a safe-snapshot method is needed rather than a naive copy.
- Whether backups must capture environment secrets (`SECRETS_ENC_KEY`,
  `ADMIN_BOOTSTRAP_*`, session secrets) — without `SECRETS_ENC_KEY` a restored
  DB's TOTP secrets are undecryptable — and where key escrow lives relative to
  the backup.
- The AnythingLLM engine's STORAGE_DIR location and ownership in the real
  deployment, since neither app repo references it.
- Backup encryption and storage destination (offsite? separate host/volume?).
- Retention policy for stored backups.
- Restore verification cadence — how often restores are drilled to confirm the
  backups are actually recoverable.
- Whether `outbox_meta.epoch` semantics survive a restore (stale-delivery
  dedupe behavior after recovery).
- Ollama capture strategy: do pulled models (re-downloadable from the Ollama
  registry, potentially tens of GB) need byte-level backup, or does a manifest of
  pulled models + captured custom Modelfiles/config satisfy the
  restore-to-functioning-state requirement? Where does Ollama's data directory
  live in the real deployment (`~/.ollama` default vs `OLLAMA_MODELS` override)?
- Apple Business Manager / iCloud feasibility (spec-writer investigation, per
  product-owner direction): are the production hosts Apple-managed devices at
  all; does iCloud's sync/backup model fit server-style SQLite/WAL and
  multi-gigabyte model data; what are the storage-quota, encryption, and
  restore-ergonomics implications versus a conventional scheduled-archive
  approach?
- The specific go-to-market date/milestone this capability is gated against.
