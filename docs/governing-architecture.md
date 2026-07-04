# Governing Architecture (source of truth)

This admin console MUST conform to the white-label strategy defined in
`front-end-custom/web/plan/AnythingLLM_Customization_Strategy.pdf`. This file is a faithful summary of
the parts that bind the BFF and frontend; the PDF is authoritative if they ever disagree.

## Core stance
The AnythingLLM engine is a **sealed, replaceable dependency**: run unmodified, pinned to a release,
upgraded on our schedule, and reached **only** through its `/api/v1/*` web API. We build our frontends
and new feature services ourselves. One dedicated box (Mac Studio) per customer site — single-tenant per
box, multiple users within it — managed as a fleet.

## The four boundary rules (a violation is a release-blocking defect)
1. **Talk only through the API.** Never the engine's database or internal files. Its internal data
   shapes are not a stable contract.
2. **Synthesize events at our boundary.** The engine is request/response and never broadcasts its
   activity. When our code makes the engine do something, our code emits the resulting **domain event**
   to **our own bus** — we made the call, so we know it happened. Never hack the engine to emit.
3. **Identities live in our DB.** A tenant/user → workspace-slug mapping table we own. The engine's IDs
   are opaque handles we look up, never strings we parse.
4. **The engine API key never reaches a browser.** Held server-side in the BFF, which brokers every
   call and enforces who-can-see-what.

## The BFF is the anti-corruption layer
It is the ONLY code that knows how to talk to the engine. On **every call** it performs, in order:
1. Authenticate our user, resolve their tenant.
2. Look up tenant → engine workspace slug.
3. Attach the server-side engine API key.
4. Translate our product request into the engine's current request shape.
5. Call the engine; stream the response back, re-shaped to our clean model.
6. **Verify-after-write:** if the call wrote data, re-read the relevant state and confirm the intended
   outcome before reporting success (the engine has known write-consistency gaps).
7. **Emit a domain event** to our event bus.

Additional rules for the layer:
- **Define our own product API first**, not the engine's. Frontends consume product verbs
  (e.g. `POST /chat`, `POST /knowledge/documents`) — the layer maps those onto whatever the engine
  currently expects. Our API is the stable contract; theirs is a hidden implementation detail.
- **No engine field-name may appear** in frontend or feature-service code. If it does, the box has leaked.
- Cover the layer with **contract tests** against the pinned engine version.
- It is the natural seam for swapping AI providers later.

## Event model (event-sourced pub/sub, owned entirely by us)
- New capabilities are **independent feature services**, not bolted into the engine. Each is decoupled,
  exposes its own REST where needed, calls **Ollama's API directly** for inference, and participates in
  an event-sourced flow over our message bus.
- **Event-synthesis principle:** we make the engine call → verify the result → **publish the domain
  event** (e.g. `document.ingested`); other services subscribe and react. Never listen to the engine.
- If an internal engine trigger genuinely cannot be observed from outside, that — and only that — is a
  candidate reason to consider the backend fork (a last resort).

## Frontend
Greenfield. Speaks only our clean API. Contains no knowledge that the engine exists. No forking of the
engine's UI — nothing to keep in sync.

## Implications for THIS admin console
- Its BFF is an anti-corruption layer: product-verb API, engine shapes confined to the BFF,
  verify-after-write on every mutation, and a **domain event emitted to the shared on-box bus** for
  every write (proposed namespace: `admin.*`).
- Because it is single-tenant per box, the tenant→workspace mapping (rule 3) is minimal, but user→
  workspace identity mapping still lives in our layer, and engine workspace slugs remain opaque handles.
