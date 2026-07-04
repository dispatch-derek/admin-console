# Spec Review — AnythingLLM Administration Console v1

**Spec reviewed:** `specs/admin-console.md` (v1, Draft)
**Grounding:** `docs/anythingllm-surface.md`
**Reviewer:** spec-reviewer subagent, 2026-07-03
**Verdict: BLOCK (revise).** The resolved OQ-1..OQ-6 decisions are internally consistent with the
requirements as written; the findings below are specification gaps/ambiguities, not challenges to
those decisions. (Env-key enumeration in grounding §5 verified to sum to exactly 186.)

---

## BLOCKERS

### BL-1 — REQ-049: workspace-membership endpoint is ambiguous ("and/or")
REQ-049 says update membership via `POST /api/admin/workspaces/:workspaceId/update-users` **and/or**
`POST /v1/admin/workspaces/{workspaceSlug}/manage-users`. These take different path identifiers and
are different upstream operations; the acceptance test passes under either, so it doesn't disambiguate.
**Fix:** Pick one endpoint as normative for v1 (state the identifier the BFF route takes and how it's
obtained), or specify both with distinct semantics and separate tests.

### BL-2 — REQ-085/073/040: enabling multi-user mode has no concrete upstream endpoint
`MultiUserMode` is a read-only flag in `GET /v1/system` and is NOT among the 186 `update-env` keys
(grounding §5.8 says "via the admin flow"). No REQ names the actual call that flips it, yet multi-user
mode is a hard precondition for all of §6.
**Fix:** Identify the concrete upstream endpoint/payload that enables/disables multi-user mode, or
record that grounding is missing it and mark user-management blocked pending that fact.

### BL-3 — REQ-031/034: workspaces with `chatMode="automatic"` have undefined display/edit behavior
REQ-034 constrains the selector to `chat`|`query`, but the customer app (same instance, §9) can set
`automatic`. REQ-031 requires displaying each field value; loading an out-of-enum value is unspecified
(coerce? blank? error?), risking a silent clobber.
**Fix:** Specify how an out-of-enum incoming `chatMode` is displayed and whether it may be written back;
state the console never sends `chatMode` unless the operator explicitly changes it.

### BL-4 — REQ-018/019: "authorized staff account" undefined given a single role
REQ-010 fixes exactly one role. REQ-018/019 let "authorized" staff disable accounts / reset others'
TOTP. Either any operator can disable everyone (self-lockout / MFA-bypass, no separation of duty), or
an undefined privileged subset exists (contradicts REQ-010).
**Fix:** Define "authorized" under a single role (e.g. all staff, but guard against self-disable /
last-account-disable, all audited), or introduce a minimal privilege distinction and reconcile REQ-010.

### BL-5 — Staff account bootstrap is unspecified
Nothing specifies how the FIRST staff account is created (seed/env/CLI) or gets its initial credential
and MFA. Without it the auth system can't be stood up.
**Fix:** Add a REQ for initial-account provisioning (mechanism, who performs it, still forces MFA per
REQ-017) with a concrete test.

---

## MAJOR

### MA-1 — REQ-050: API-key view has no upstream read endpoint
Grounding §4 documents the `api_keys` table but lists no `GET` route. REQ-050 cites no route; the test
can't run.
**Fix:** Cite the concrete upstream endpoint that returns `api_keys`, or note none exists and re-scope.

### MA-2 — REQ-078a: raw editor's "non-secret key shows current value" has no defined read source
`GET /v1/system` returns a curated `settings` object (secrets as booleans); it's not established it
returns plaintext for all 186 non-secret keys, and `env-dump` must be masked (REQ-074).
**Fix:** Specify which endpoint yields current non-secret values, and the display state when none does.

### MA-3 — REQ-023: blanket `403 → "Invalid API Key"` conflates distinct failures
Upstream `403` also means multi-user-off or insufficient role, not just bad key. REQ-023 mislabels all
of these; also mismatches REQ-097 operator text.
**Fix:** Distinguish key-rejection 403 from authz/precondition 403; state whether UI renders the BFF
`message` verbatim or derives its own.

### MA-4 — REQ-051: chat export referenced but never specified
REQ-051 defers export to §8/§10, but no REQ implements `GET /v1/system/export-chats` and §8 has no
export guardrail.
**Fix:** Add a REQ (endpoint + §8 guardrail) for export-chats, or fence it under §11 non-goals.

### MA-5 — REQ-036a/077: "effective provider" is undefined
Dropdown-vs-free-text hinges on whether the effective provider is Ollama, but the term is undefined:
workspace's own `chatProvider === "ollama"` vs. resolved provider including `null`-inherits-system.
**Fix:** Add "effective provider" to §2 glossary with the exact resolution rule (workspace field if set,
else system `LLMProvider`) and align REQ-036a/077.

### MA-6 — REQ-035: numeric boundaries and null-clearing unspecified
`similarityThreshold (0–1)` inclusivity unstated; `openAiTemp (≥0)` has no upper bound; clearing a
numeric back to default is undefined.
**Fix:** State inclusive/exclusive edges per range and whether/how a numeric can be cleared to inherit.

---

## MINOR

- **MI-1 — REQ-097:** upstream `401/404/429`/other non-403/400/5xx have no operator-message mapping.
- **MI-2 — REQ-048/049:** `workspaceId` source unclear (grounding §3 workspace fields don't list numeric `id`; REQ-030/031 use `slug`).
- **MI-3 — REQ-078c/088a:** "typed confirmation naming the key(s)" has no match criterion for multi-key raw writes (type every key? a count? one?).
- **MI-4 — Uncovered/unfenced endpoints:** `GET /v1/users/{id}/issue-auth-token` (effectively impersonation) and `POST /v1/admin/preferences` are neither in scope nor in §11 non-goals. `issue-auth-token` especially needs a deliberate include-with-guardrail or exclude.
- **MI-5 — REQ-039:** document attach/detach (`update-embeddings`) needs document identifiers, but no document-list/upload endpoint is in scope. Specify selection source or scope to detach-only.
- **MI-6 — REQ-095:** production CORS specified but dev-mode CORS behavior undefined.

---

## NIT

- **NI-1 — REQ-078b** uses "~186-key" (tilde) while REQ-096 says "the accepted key set." Enumeration sums to exactly 186; drop tilde, point both at the §5 list as single source of truth.
- **NI-2 — REQ-085** cites "§7.3-admin flow" for enabling multi-user mode, but §7.3 is *Embedding*; correct pointer is §7.8 (REQ-072/073).
- **NI-3 — REQ-023** mentions streaming `502` mirrored from the customer BFF, but the admin console defines no streaming routes; confirm whether this is dead text.

---

## Prioritized summary
1. **BL-2 (multi-user enable endpoint)** and **BL-1 (REQ-049 and/or)** block the entire user-management path — resolve endpoints first.
2. **BL-5 (first-account bootstrap)** and **BL-4 (single-role authz for staff lifecycle/MFA reset)** are security-blocking gaps in the auth model.
3. **BL-3 (`automatic` chatMode display)** — small but concrete correctness gap given customer-app coexistence.
4. **Majors** cluster around unspecified read sources and error semantics: MA-1/MA-2 (read sources), MA-3 (403 conflation), MA-4 (export-chats dangling), MA-5 (effective provider), MA-6 (numeric edges/null).
5. Minors/nits are quick precision fixes; MI-4 (`issue-auth-token` impersonation) deserves a deliberate decision.
