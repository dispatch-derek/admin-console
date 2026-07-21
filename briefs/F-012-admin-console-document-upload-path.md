# F-012: Admin-console document upload path: raw binary file ingestion

## Problem

An admin managing a workspace's knowledge in the admin console can only work with
documents that are *already* present in the engine's document pool. The knowledge
surface (`web/src/features/workspaces/KnowledgePanel.tsx`) offers attach, detach, and
pin over that existing pool; the BFF route behind it
(`PUT /api/workspaces/:id/knowledge`, `bff/src/routes/workspaces.routes.ts:67-78`)
accepts only string reference lists (`{adds?, deletes?}`) and rejects an empty pair
with a 400. The engine adapter (`bff/src/engine/adapter.ts:145,159`) likewise deals
only in document references and pool listings.

There is no path anywhere in the admin console by which a new document enters that pool.
Documents currently arrive through the AnythingLLM engine's own frontend — a
drag-and-drop upload UI in its ManageWorkspace → Documents modal
(`frontend/src/components/Modals/ManageWorkspace/Documents/UploadFile/index.jsx:6,78`)
posting to `POST /workspace/:slug/upload` (`server/endpoints/workspaces.js:116`), a
session-authenticated route distinct from the API-key path.

The observable consequence is therefore not that the work is impossible, but that it is
split across two applications: an admin holding a file that a workspace needs must leave
the admin console, authenticate separately to the engine's own interface, upload there,
and return to the console to attach and pin. The console's knowledge surface presents a
management view over content it has no ability to originate, and the origination step
happens somewhere the console does not own, does not surface, and cannot report on.

## Affected Users

Admin-console staff users who manage workspace knowledge — i.e. anyone who reaches the
knowledge panel in workspace settings (`web/src/features/workspaces/WorkspaceSettings.tsx:352`).
That is the population functionally scoped to this gap.

**Honest limits on quantification:** this repository contains no usage analytics, no
telemetry on knowledge-panel interactions, and no support-ticket intake. There is
therefore no in-repo basis to state what share of admin users hit this, how often they
hit it, or how many documents per period are being routed around the console. Those
figures are not available and are deliberately not estimated here. Establishing
frequency and share is work for the scoring-time evidence pass, drawing on sources
outside this repo.

## Business Rationale

The falsifiable claims available:

1. The admin console is positioned as the operational surface for workspace
   administration, yet one step of the knowledge lifecycle — getting a document into
   the pool — is not performable there. **This claim was tested during drafting and
   survives only in weakened form.** The originally-suspected version ("the task cannot
   be completed at all") is false: the engine's own frontend ships a working
   drag-and-drop upload UI, so admins are not blocked. What remains is a
   consolidation-and-context-switch argument — the task requires leaving the console for
   a second application with separate authentication, and the console cannot see or
   report on ingestion it does not mediate. Whether that split is a real operational
   cost or merely an aesthetic one is not established from in-repo material and is the
   central thing scoring-time evidence should test. Falsifiable by: finding that admins
   are comfortable in the engine UI, or that ingestion is genuinely a different role's
   job and does not belong in the console at all.
2. The engine capability required already exists and the credential to call it is
   already provisioned (`bff/src/config.ts:60`, `anythingLLMApiKey`). The cost argument
   is therefore about the intake path on this side, not about building or licensing a
   new ingestion capability. Falsifiable by: finding that the engine endpoint does not
   behave as documented, or that the existing key lacks the required scope.
3. Because each BFF calls the engine directly (see ruling in Existing Evidence),
   admin-console gains this capability without incurring or imposing cross-repo
   coordination cost. Falsifiable by: discovering a shared component that in fact must
   be built once and reused.

No revenue, retention, or contract-driven argument is available from in-repo material.
None is asserted here.

## Timing

**None known.** No deadline, regulatory date, contract commitment, competitive move, or
seasonal window has been supplied for this feature.

Specifically, the sequencing pressure that exists around customer-web-app's F-002 /
F-003 does **not** transfer to this item: per the 2026-07-20 ownership ruling, the two
apps build their upload paths independently and neither blocks the other. Any urgency
attached to this row on the assumption that customer-web-app is waiting on it would be
mistaken.

## Existing Evidence

All entries below were supplied by the human from in-repo inspection during the
2026-07-20 drafting session. **No discovery scan was run**, so nothing here carries an
`[agent-discovery]` tag. Every entry is a **lead to re-verify at scoring time**, not
settled fact — file contents and line numbers drift.

**Engine capability (AnythingLLM, `/home/derek/git/anything-llm`):**
- `POST /v1/document/upload` exists — `server/endpoints/api/document/index.js:50`.
  `multipart/form-data`, single file field named `file`, guarded by `validApiKey`,
  optional query `?addToWorkspaces=slug1,slug2` to embed post-upload. Returns
  `{success, error, documents}`.
- Sibling endpoints: `POST /v1/document/upload/:folderName`
  (`index.js:175`, accepts metadata) and `POST /v1/document/upload-link` (`index.js:356`).
- No server-side size limit on the upload path — `server/utils/files/multer.js:116-117`
  uses `multer({storage: fileAPIUploadStorage}).single("file")` with no `limits` option.
  Contrast `multer.js:178-180`, a different handler that *does* cap at 25MB. Any
  per-file size gate must therefore be imposed by the caller.
- Upload requires the document-processing collector to be online; the handler returns
  500 with "Document processing API is not online" when it is not
  (`index.js:130-140`).

**The current out-of-console ingestion channel (verified 2026-07-20, resolving what was
Open Question 6 in an earlier draft):**
- The engine's own frontend ships a working document upload UI — ManageWorkspace →
  Documents modal,
  `frontend/src/components/Modals/ManageWorkspace/Documents/UploadFile/index.jsx:6,78`,
  built on `react-dropzone`, with a dedicated `FileUploadProgress` component alongside it.
- It posts to `POST /workspace/:slug/upload` (`server/endpoints/workspaces.js:116`) — a
  **session-authenticated** route, distinct from the API-key-guarded `/v1/document/upload`
  that this feature would call. Sibling native routes include
  `/workspace/:slug/upload-link` (`workspaces.js:166`) and
  `/workspace/:slug/upload-and-embed` (`workspaces.js:906`).
- That UI also supports **deletion** — `System.deleteDocuments` behind a
  `window.confirm` (`frontend/src/components/Modals/ManageWorkspace/Documents/Directory/index.jsx:53-89`)
  — plus folder organization. Relevant to the reversibility question below: the channel
  admins use today can remove what it creates.

**admin-console current state (this repo):**
- `bff/src/engine/adapter.ts` has no byte-upload method. `updateEmbeddings`
  (`adapter.ts:145`) POSTs `/workspace/{slug}/update-embeddings` with `{adds, deletes}`
  — string document references only. `listDocuments` (`adapter.ts:159`) reads the
  engine's existing pool.
- `PUT /api/workspaces/:id/knowledge` (`bff/src/routes/workspaces.routes.ts:67-78`)
  accepts only `{adds?: string[], deletes?: string[]}` and 400s on an empty pair.
- No multipart handler and no multipart dependency anywhere under `bff/src`.
- `bff/src/config.ts:60` already holds `anythingLLMApiKey: requireEnv('ANYTHINGLLM_API_KEY')`
  — the credential the engine upload endpoint requires is already configured.
- UI: `web/src/features/workspaces/KnowledgePanel.tsx` supports attach/detach
  (`api.changeKnowledge`, lines 65 and 89) and pin (line 75) over the engine's existing
  pool; rendered from `web/src/features/workspaces/WorkspaceSettings.tsx:352`. No
  control anywhere in the console adds a *new* document to that pool.

**Sibling repo (customer-web-app, `/home/derek/git/customer-web-app`):**
- Its brief `briefs/F-002-raw-document-upload.md` describes the same reference-only
  limitation on its own side, and lists "What is the engine's actual upload interface?"
  as an open question. That question is **answered** by the engine facts above — a lead
  customer-web-app can pick up independently. It is not a dependency in either
  direction.

**Human rulings, 2026-07-20 (settled; recorded here so later readers are not misled):**
- *Ownership correction.* Each BFF calls the engine directly. admin-console implements
  its own multipart intake, its own per-file size gate, and forwards to
  `/v1/document/upload` with its own API key; customer-web-app does the same
  independently. **F-012 is the admin-console half only.** There is no cross-app build
  dependency and customer-web-app's F-002 is not blocked by this feature. This corrects
  the workbook row title
  ("…support raw binary file ingestion for customer-web-app"), which was framed on the
  earlier assumption that admin-console might be a prerequisite for customer-web-app.
  The row title is stale in that respect; this brief's scope governs.
- *UI scope.* An admin-facing upload surface is in scope for this feature alongside the
  BFF path. Where it lives is not settled — see Proposed Direction.

## Proposed Direction

Non-binding sketch. A multipart intake on the admin-console BFF would accept a single
file from an authenticated staff user, apply a per-file size gate and a file-type gate
on this side (the engine imposes neither on that path), and forward the file to the
engine's `POST /v1/document/upload` using the already-configured `ANYTHINGLLM_API_KEY`,
returning the engine's document result to the caller. On the front end, an upload
control would sit alongside the existing attach/detach/pin affordances so that
originating a document and attaching it are reachable from the same place — the
existing knowledge panel is the natural candidate, but placement, and whether upload
auto-attaches to the current workspace or simply lands in the pool, are open and should
be settled during design and spec, not fixed here. The collector-offline failure mode
needs a deliberate, legible response rather than a raw 500 passthrough.

## Design Considerations

Two reads from the **ux-designer agent** (2026-07-20), recorded verbatim. These inform
the human's later Effort and Risk scores; they do not set them.

- **complexity_read:** The placement is continuous with what exists — the knowledge panel
  is already a single `<section>` with an "Attached" list and an "Available to attach"
  list, and an origination affordance reads as a third region in that same section, using
  the same Button variants and `ac-document-list` idiom. Nothing new is needed to *site*
  the control. What has no precedent in this codebase is the control itself and its
  progress semantics. There is no file input, FormData construction, drag-drop handler,
  accept-attribute, or progress element anywhere under `web/src` — a grep for all of those
  returns nothing, and WorkspaceSettings currently ships the hint text "Binary avatar
  upload is not available in v1." on the avatar field, so the console today tells users
  in-product that binary intake is absent. The design system's `Input` is a controlled
  `value` component with no `accept` or `multiple` prop and cannot serve a file control,
  so a net-new component is implied rather than a prop addition; whether it is a bare
  labelled file input or a drop zone with a file-input fallback is the fork that decides
  how much is new.

  Async feedback is the second novel piece. Every mutation in KnowledgePanel today is
  fire-and-await with a boolean `busy` and no visible in-flight state except the disabled
  DangerConfirm button — attach and pin have no busy state at all. Upload spans a network
  transfer plus server-side parse/embed, so it occupies a duration those operations were
  never designed to communicate. The closest existing pattern is BaselinePreviewApply's
  `role="status" aria-live="polite"` outcome panel, which announces a *result* after a
  long apply; it is a usable template for a determinate-free "Uploading… / Processing… /
  Done" text status, and reusing it avoids inventing a percentage bar. There is no spinner
  primitive, no `@keyframes`, and no `prefers-reduced-motion` rule in the codebase, so any
  animated indicator introduces a motion concern the project has not had to answer before
  — a text-only status region sidesteps that entirely. Design-system fit is otherwise
  good: the tokens F-001 established (`--theme-*`, `--fs-*`, `--radius-*`,
  `--border-hairline`) cover a drop zone's border, background, and muted helper text
  without new tokens, with the exception of a dashed/active drop-zone border treatment,
  which has no token today.

  One open shape question worth naming for the direction, not resolving here: if upload
  auto-attaches, the result must land in the "Attached" list and the panel already has the
  refresh path for that (`changeKnowledge` returns the updated workspace); if it lands
  unattached, the result must appear in "Available to attach", which is fed by a
  `listDocuments()` call made once on mount and never refetched — that list would need a
  re-read it does not currently do.

- **ux_risk_read:** Accessibility exposure concentrates in three places. First, the
  control: a native file input is keyboard-reachable and screen-reader-labelled for free,
  but the common visual treatment (hide the input, style a label as a button) is exactly
  where focus-visible styling and accessible naming are usually lost; a drop zone adds a
  second path that is mouse-only unless a keyboard-operable trigger is paired with it, and
  drag-drop has no keyboard equivalent by nature. This repo carries an unresolved WCAG
  contrast defect (D-002), so a new surface with dashed borders, muted helper text, and a
  disabled-while-uploading state is adding contrast decisions on top of an already-open
  one — a reason to prefer treatments that inherit existing `--theme-*` pairs rather than
  introduce new ones. Second, announcement: ErrorBanner is `role="alert"` and, per
  REQ-097a, renders the BFF message verbatim and never rewrites it. Client-side gate
  rejections (size, type) never reach the BFF, so they have no upstream message to render
  and need their own copy and their own announcement decision — whether they reuse
  ErrorBanner, attach to the control via the Input/FieldFrame error + `aria-describedby`
  pattern, or both. Third, focus: the panel already solved the analogous problem for
  detach with `headingRef`/`fallbackFocusRef`, so a post-upload focus target has a
  precedent to copy, but it must be decided rather than inherited — after a successful
  upload the control may be reset and the list re-rendered underneath focus.

  Reversibility is the sharpest exposure. Detach today is gated behind DangerConfirm with
  explicit consequence copy because it destroys vector data. Upload is the mirror image:
  it creates state in a shared pool that this feature gives the admin no way to remove,
  since pool deletion is out of scope. A mistaken upload — wrong file, wrong workspace, a
  document that shouldn't be in a shared pool at all — is therefore not undoable from the
  console, and if the direction lands on auto-attach the admin can detach from the
  workspace but the document persists in the pool visible to every other workspace's
  picker. That asymmetry deserves either pre-commit confirmation (filename echoed back
  before send) or explicit copy stating what cannot be taken back, in the same spirit as
  the existing detach and baseline-apply consequence text.

  Legibility of rejection paths is where most real user encounters will happen, and the
  three paths differ in kind: the size and type gates are local, instant, and should name
  the limit and the accepted types rather than say "rejected"; collector-offline is
  remote, arrives after the user has already waited through an apparent upload, and is not
  the user's fault or fixable by retrying with a different file — conflating it with the
  local gates would send admins hunting for a problem in their file. Distinguishing "your
  file won't work" from "the system can't take files right now, try later" is the
  interaction question here, and it is worth a round of observation with actual staff
  users rather than being settled from the design side alone.

## Out of Scope

- **The customer-web-app half.** Its upload path is built independently on its own side
  (2026-07-20 ownership ruling); nothing in this feature is shared with or blocking for
  it.
- **The engine's own upload, parsing, chunking, and embedding behavior.** Consumed as
  is; not modified.
- **How the engine's document-processing collector processes documents.** Its behavior
  and availability are treated as given; only this side's handling of an offline
  collector is in play.
- **URL/link ingestion** (`POST /v1/document/upload-link`) — excluded unless
  specifically argued back in.
- **Folder-targeted and metadata-bearing upload variants**
  (`POST /v1/document/upload/:folderName`) — excluded unless specifically argued back in.
- **Bulk / multi-file / batch upload.** Single-file intake is the shape assumed here;
  batch is a separate item.
- **Document lifecycle management beyond ingestion** — no deletion from the pool,
  re-processing, or versioning. *Contested:* the no-deletion half of this exclusion is
  challenged by Open Question 8 and should be ruled on before this brief becomes a spec.

## Open Questions

1. **What per-file size gate value is correct?** The engine imposes none on this path
   (`server/utils/files/multer.js:116-117`), so the number is entirely this side's
   choice. The 25MB cap on the engine's *other* handler (`multer.js:178-180`) is a
   reference point, not a precedent — is it the right one here?
2. **What should happen when the document-processing collector is offline?** The engine
   returns a 500 with "Document processing API is not online"
   (`index.js:130-140`). Should the console pre-check availability, surface a specific
   message, queue and retry, or simply pass the failure through?
3. **Should an upload auto-attach to the current workspace, or land unattached in the
   pool?** The engine's `?addToWorkspaces=` query makes both cheap; the right default
   is a product decision, and may depend on where the control is placed.
4. **Which file types should the gate accept?** Unresolved whether to mirror whatever
   the engine's collector can parse, restrict to a narrower explicit allow-list, or
   accept anything and let the engine reject.
5. **Do any non-staff roles ever need to upload?** This brief assumes admin-console
   staff users only. If other roles in the console's authorization model should have
   the capability, that changes the authorization surface.
6. **Do admin-console staff actually have engine-frontend access, and is sending them
   there acceptable?** The channel itself is now identified (engine's own ManageWorkspace
   upload UI — see Existing Evidence), so the remaining unknown is narrower: whether the
   admins who use this console hold engine accounts at all, whether they currently use
   that UI or route requests to someone who does, and whether the two-app split is felt
   as friction or is simply how the work is organized. This is the question that decides
   whether Business Rationale claim 1 holds in its weakened form or fails outright.
7. **Is there any per-user or per-workspace quota / rate consideration on ingestion?**
   Nothing in-repo addresses it; unclear whether it needs to.
8. **Should this feature ship a create-only action with no undo?** Pool deletion is
   currently in Out of Scope, which means an admin who uploads the wrong file — or a
   document that should not be in a shared pool at all — cannot remove it from the
   console. The engine's own UI, which is what admins use today, *does* support deletion
   (`Directory/index.jsx:53-89`), so a console upload without it would offer strictly
   less capability than the channel it is meant to replace, and the document would remain
   visible in every other workspace's attach picker. Options to rule on: accept the
   asymmetry and mitigate with pre-commit confirmation and explicit copy; pull a delete
   path into scope; or gate upload behind a narrower role. Bears directly on the
   reversibility concern in the ux_risk_read above.
