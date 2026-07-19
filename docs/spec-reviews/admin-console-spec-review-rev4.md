# Spec Review — AnythingLLM Administration Console v1 (rev 4)

**Spec reviewed:** `specs/admin-console.md` (rev 4)
**Grounding:** `docs/anythingllm-surface.md` · **Governing:** `docs/governing-architecture.md`
**Reviewer:** spec-reviewer subagent, 2026-07-04 · Focus: rev-4 additions (§4, §14, §5–§7 mapping, §9)
**Verdict: BLOCK (revise).** OQ-1..OQ-6 and BL-1..NI-3 decisions were not reopened. Workspace field
maps (REQ-032) are complete; leakage/mapping problems are confined to instance settings. The event
model is the weakest rev-4 area.

---

## BLOCKERS

### BLK-1 — "Exactly one event per verified write" (REQ-029) contradicts the multi-event requirements it governs
REQ-029 says the BFF emits **exactly one** `admin.*` event per verified mutation, but several routes require more:
- REQ-043 (`PATCH /api/users/:id`): `admin.user.updated` **plus** `suspended`/`reactivated` if the flag toggled.
- REQ-049 (`POST …/members`): one `assigned` per added user **and** one `unassigned` per removed user (N+M).
- REQ-063 / §7 intro: `instance.setting_changed` **plus** `instance.provider_changed` when a provider selector changes.
REQ-029e then says "at least one" — silently contradicting "exactly one."
**Fix:** replace "exactly one" with "one or more" and state per-operation cardinality (one per state delta; one per added/removed member; one `setting_changed` + one `provider_changed` per changed provider selector). Align REQ-101.

### BLK-2 — Verify-after-write (REQ-028) is impossible for secret-overwrite and write-only keys, yet those writes are permitted and required to emit events
`GET /v1/system` returns secrets as booleans, so overwriting an already-set secret (rotation) re-reads `true` before and after — the new value is unobservable. Write-only keys (REQ-078a) can never be re-read at all. REQ-028 then forces "not confirmed" → REQ-029b emits no event → contradicts REQ-078d ("a verified raw write emits `admin.raw_env.written`"). Also a security concern: rotations can't be confirmed.
**Fix:** define the verify contract per key class — set/unset secrets confirm the transition where observable else best-effort labeled `unverified`; write-only keys are exempt from re-read, with "success" and event emission defined for them (e.g. 200 + `unverified` marker).

### BLK-3 — §7 curated settings have no product↔engine field-name map, so REQ-021a (no engine key names in web/) is unimplementable-as-written for all of §7
Workspaces have a precise map (REQ-032); the 186 instance keys do not — §7.1–§7.8 are written entirely in engine key names. REQ-021a's scan forbids exactly those names in `web/`. Implementers must either invent divergent product ids (ambiguous) or reference engine names (release-blocking).
**Fix (decision needed):** add a §7 product↔engine settings map analogous to REQ-032, OR state that curated-control-to-key binding is BFF-internal and REQ-021a's scan does not require `web/` to carry per-key product names for settings (define how the scan treats §7).

---

## MAJOR
- **MAJ-1** — Pin/unpin (REQ-039) is a mutation whose verify step describes attach/detach, not pin state, and has no catalog event (violates REQ-029e). Add `knowledge_pinned/_unpinned` + pin-state verify, or fold into `documents_changed` with a pin-state read.
- **MAJ-2** — Membership ownership contradiction: REQ-021b says our layer owns assignment state; §6.4 treats the engine as source of truth (reads/writes/verifies engine membership). State the engine is authoritative for membership content and our layer owns only the handle↔slug/id mapping; reconcile REQ-021b.
- **MAJ-3** — Delete verify (REQ-038/044) confirms success via a 404 re-read, but REQ-097 maps 404→error. State that for deletes, 404-on-re-read is the confirmed-success signal, not the error path.
- **MAJ-4** — Per-user membership events (REQ-049) require a pre/post diff, but no pre-membership snapshot is in the §4.2 chain, and no-op adds are undefined. Specify a pre-write snapshot; emit only on actual deltas.
- **MAJ-5** — REQ-087 guards `remove-documents` but no product route/verify/event defines it (orphan). Add route+verify+event, or drop it and note as non-goal (workspace-detach via REQ-039 covers workspace-scope vector deletion).

## MINOR
- **MIN-1** — REQ-077/OQ-3 name workspace model fields by engine names (`chatModel`/`agentModel`); use product names (`llmModel`/`agentLlmModel`).
- **MIN-2** — `provider_changed` count undefined for a batch changing multiple provider selectors; state one per changed selector.
- **MIN-3** — `setting_changed` payload `category` (singular) can't represent a multi-category batch; use `categories[]` or key off touched key names.
- **MIN-4** — Numeric workspace id may be absent right after create (REQ-037 records only slug; REQ-048 needs the id). Specify create populates the id into the mapping layer.
- **MIN-5** — `avatar`→`pfpFilename` edit mechanism unspecified (upload vs filename). Specify or mark out of scope.
- **MIN-6** — `retrievalMode` (`vectorSearchMode`) has no value constraint unlike `responseMode`. State allowed values or validated free-text.

## NITS
- **NIT-1** — REQ-019a bootstrap env vars via `requireEnv` implies they must stay set on every boot; confirm or scope to first-boot.
- **NIT-2** — Fresh-read-before-write (REQ-092) covers instance-settings dangerous ops but not workspace delete (REQ-038); confirm intentional.

---

## Prioritized summary
1. BLK-1 event cardinality · 2. BLK-2 verify feasibility for secrets/write-only · 3. BLK-3 §7 product vocab
· 4. MAJ-1 pin event · 5. MAJ-2 membership ownership · 6. MAJ-3 delete-404 · 7. MAJ-4 membership deltas
· 8. MAJ-5 orphan remove-documents · then MIN-1..6, NIT-1..2.
