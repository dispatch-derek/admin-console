# F-010: Deliver admin.* events to customer-web-app: add its ingest endpoint to the relay peer list

## Problem — what's broken/missing, for whom, observed how. (feeds: user_value)

admin-console's implemented F-004 relay drains its outbox to a configured list of HTTP peers,
but customer-web-app (cwa) is not among them, and this deployment's relay is not carrying
anything to anyone: `bff/.env:25` sets `EVENT_BUS_MODE=inproc` with no `EVENT_BUS_URL` line,
and `bff/.env.example:23-25` ships `EVENT_BUS_URL=` empty. The consequence is that
`admin.user.*` state changes made in admin-console (create, update, suspend, reactivate,
delete — 5 of the 21 `admin.*` names in `bff/src/events/catalog.ts:5-29`) stay inside
admin-console. Any downstream system that needs to know an admin-console user changed has no
way to learn it from this app.

There is a second, distinct gap underneath the missing peer entry. cwa's spec
(`~/git/customer-web-app/specs/F-005-cross-app-identity-sync.md` §3.6, REQ-F005-061) names
three required elements on the wire: the envelope body, the `X-Event-Delivery-Id` header, and
a shared-secret credential. This app's outbound POST sets exactly two headers —
`content-type: application/json` and `x-event-delivery-id`
(`bff/src/relay/http-peer-transport.ts:10,60-67`) — and there is no credential-carrying code
path anywhere in `bff/src/relay/` or `bff/src/events/`, nor any secret among the 8 relay
config keys or the 8 `EVENT_BUS_*` env vars (`bff/src/relay/config.ts:1-60`). So two of the
three named wire elements exist and the third has no implementation at all.

That gap is not cosmetic, because of how the existing fan-out composes. `deliver()` resolves
only when every peer returns 2xx; a permanent outcome from any not-yet-acked peer parks the
whole ordering key regardless of what other peers acked, and an outbox row is marked published
only after all N peers ack (`bff/src/relay/http-peer-transport.ts:29-34,36-45,55,84-95,99-101`;
`specs/F-004-production-event-bus.md:483`). cwa returns 401 on auth failure, and 401 lands in
the permanent branch of this app's REQ-F004-055 classifier (2xx ack / 5xx-408-429-network
transient / everything-else-4xx-and-3xx permanent) — permanent park by design on cwa's side.
The workbook row's own note describes the relay-side work as "config-only on the relay side
(comma-list peer per REQ-F004-052) **plus credential provisioning/runbook**" — so the note does
scope credential work in. What the evidence above adds is that the credential cannot be
*provisioned* into anything, because no code path carries one: a peer added today would be
parked permanently by its own consumer on first delivery rather than delivering anything. The
work is therefore a transport change plus config, not configuration alone.
*(Correction applied 2026-07-20: an earlier revision of this brief claimed the row's note was
contradicted outright. That overstated it — the note anticipated credential provisioning; only
the "config-only on the relay side" characterization is off, and the missing code path is the
substantive finding.)*

Honest statement of who feels this today: **nobody currently does.** cwa's
`/api/events/ingest` does not exist in code (0 of 41 `bff/src` files and 0 of 9 route modules
in cwa implement it; it is spec-text only, cwa `specs/F-005-cross-app-identity-sync.md:179-193`),
and cwa's F-005 row is In Progress; no cwa row covering the ingest endpoint is Implemented
(cwa's F-001 *is* Implemented, but it is the BFF-layer/domain-events row, not ingest). The
missing capability is a producer-side precondition for consumer work that has not been built,
not an outage anyone is presently experiencing.

## Affected Users — segments, share, frequency. (feeds: reach)

- **Direct consumer segment (prospective, not live):** customer-web-app, as an HTTP peer of
  this app's relay. cwa F-005 "cross-app identity sync" is the named consumer; its ingest
  endpoint is unbuilt (see Problem). Share of live traffic affected today: zero, because no
  peer is configured and the receiving endpoint does not exist.
- **End users indirectly implicated (unmeasured):** users who exist in both admin-console and
  customer-web-app and whose identity state diverges between the two apps. This brief has no
  measurement of how many such users exist, how often admin-side identity changes occur, or
  what the observed divergence rate is — no usage analytics, no support tickets, and no intake
  records were found for this. That absence should be treated as a genuine gap in reach
  evidence rather than filled in by assumption.
- **Event-stream shape:** the relay fans out all 21 `admin.*` names to every peer and the
  consumer filters (cwa spec `:248`); the `admin.user.*` subset cwa cares about is 5 of 21
  (23.8%) of catalog names. Frequency of those emissions in production is not instrumented in
  anything this brief could read.
- **Operators of this app:** whoever configures and runs the bff. They are affected in that
  the relay's production boot hard-refuses an empty peer list (`bff/src/relay/config.ts:27-34`),
  so any move off `inproc` mode forces a peer-list decision. Count of such operators is not
  recorded here; there are 0 docker-compose / k8s / Dockerfile artifacts in-repo, so the
  deployment topology is not visible from this repository.

## Business Rationale — falsifiable claims. (feeds: business_value)

1. **This is a hard precondition for a tracked, in-flight consumer feature.** cwa F-005 is
   status In Progress (rank 4, date_scored 2026-07-19) and its spec §3.6 pins four
   producer-side requirements (REQ-F005-060 through -063) that only admin-console can satisfy.
   Falsifiable: if F-005 could reach a working end-to-end state without admin-console
   registering cwa as a peer and sending a credential, this claim is wrong.
2. **The wire contract is already frozen on the consumer side, so the integration cost is
   bounded and known.** REQ-F005-062 freezes the envelope (`admin.user.created` keeps
   `changes = { username, role }`, no credential in the envelope, no new payload field) and
   REQ-F005-011 pins the delivery-id shape `<outbox-epoch>:<row-id>`, which this app already
   produces (`http-peer-transport.ts:10,62`; 9 references across 6 files). Falsifiable: if a
   later cwa revision changes the envelope or the delivery-id contract, the bounded-cost claim
   is void.
3. **Without a credential path, adding the peer would produce parked deliveries rather than
   delivered ones.** Falsifiable by test: configure cwa as a peer with no credential header,
   observe cwa's 401, and check whether the ordering key parks permanently per the classifier
   and fan-out behavior cited in Problem.
4. **Cross-row observation (not a scoring proposal):** D-006 (GH issue #16, OPEN, workbook
   status Prioritized) justifies its `reach = 1` on the stated basis that `EVENT_BUS_MODE=inproc`
   and `EVENT_BUS_URL` is empty, i.e. `HttpPeerTransport` is currently inactive. If F-010 puts
   a real peer on the wire, that stated basis no longer holds, and the fan-out composition
   above means a second peer also changes D-006's blast radius. Neither the issue nor the
   workbook row records any dependency on peer expansion, cwa, or F-010. This is flagged as a
   consistency issue for whoever re-examines D-006; this brief proposes nothing about D-006's
   scoring.

Honest limit so business value is not inflated: there is no revenue claim, no observed-usage
claim, and no customer-demand record behind this row. The value case is **completing a
producer-side precondition for a named-but-unbuilt consumer**, and its realization depends on
cwa work this repo does not control.

## Timing — deadlines/windows. (feeds: time_sensitivity)

The timing driver on record is the **October 2026 go-to-market goal** (product-owner ruling,
2026-07-19). Encoded exactly as cwa's F-007 brief encodes it: October 2026 is an **internal
company goal date, not an external or regulatory deadline** — its concrete date and the precise
definition of what GTM requires of this row are both still unpinned (see Open Questions).

Countervailing evidence to keep visible: across both repos, "October 2026" appears 28 times in
14 files, and **0 of those matches connect the date to F-010, the relay peer list, or the cwa
ingest endpoint.** The corpus also carries two conflicting characterizations — admin-console
`specs/F-001-adhere-to-design-system.md:787-789` treats it as a hard compliance gate for F-001
scope, while cwa `briefs/F-007-production-event-relay-twin.md:102-104,121,223` records the
2026-07-19 product-owner ruling that it is an internal goal with the concrete date still open.
The ruling above is authoritative for this row; the conflict is recorded so a later pass does
not mistake the F-001 framing for this row's.

A softer sequencing consideration, not a deadline: the consumer endpoint does not yet exist
(see Problem), which bounds how much of this work can be verified end to end at any given
moment regardless of calendar pressure.

## Existing Evidence — pointers only; a later research pass re-verifies. (feeds: confidence)

Human leads (untagged):
- Product-owner rulings, 2026-07-19: (a) F-010 scope is peer registration + shared-secret
  credential provisioning + runbook; broader relay transport hardening (HMAC/mTLS, https-only
  peer enforcement) stays with D-006 as a separate row; (b) the October 2026 GTM goal applies
  to this row and is an internal company goal, not an external or regulatory deadline, concrete
  date and requirements unpinned.
- Cross-repo seam, verified: cwa `specs/F-005-cross-app-identity-sync.md` §3.6, REQ-F005-060
  (peer URL in `EVENT_BUS_URL` comma-list), -061 (envelope + `X-Event-Delivery-Id` + shared
  secret), -062 (envelope frozen), -063 (response classification composes with this app's
  REQ-F004-055; cwa's 401 = permanent park by design).
- Workbook row F-010's own `rationale_notes` claim that this is "config-only on the relay
  side" — recorded as a lead to re-verify, and contradicted by the credential finding below.

Agent-discovery leads (re-verify; these are prior agent output, not established fact):
- `[agent-discovery 2026-07-19]` Outbound POST sets exactly 2 headers (`content-type`,
  `x-event-delivery-id`) at `bff/src/relay/http-peer-transport.ts:10,60-67`; cwa names 3
  required wire elements, so the credential has no code path.
- `[agent-discovery 2026-07-19]` `x-event-delivery-id`: 9 references across 6 files; value
  shape `<outbox-epoch>:<row-id>` matching cwa REQ-F005-011. Producing site
  `http-peer-transport.ts:10,62`; e2e stub peer `tests/e2e/relay/fixtures/stubPeer.ts:55`.
- `[agent-discovery 2026-07-19]` Credential mechanism: 0 credential-carrying code paths in
  `bff/src/relay/` or `bff/src/events/`; 0 of 8 relay config keys and 0 of 8 `EVENT_BUS_*` env
  vars carry a secret (`bff/src/relay/config.ts:1-60`).
- `[agent-discovery 2026-07-19]` Peer-URL validation: `bff/src/relay/config.ts:13-17` performs
  3 transform steps (split/trim/filter) and 0 scheme or host validation; `http://` is accepted,
  and all 3 README example peer URLs are `http://` (`bff/src/relay/README.md:24,37,51`).
- `[agent-discovery 2026-07-19]` Fan-out composition (`http-peer-transport.ts:29-34,36-45,55,
  84-95,99-101`; `specs/F-004-production-event-bus.md:483`): `deliver()` resolves only when
  every peer returns 2xx; a permanent outcome from any not-yet-acked peer parks the whole
  ordering key; a row is published only after all N peers ack.
- `[agent-discovery 2026-07-19]` cwa `/api/events/ingest` does not exist in code: 0 of 41
  cwa `bff/src` files and 0 of 9 route modules implement it; spec-text only, cwa
  `specs/F-005-cross-app-identity-sync.md:179-193`.
- `[agent-discovery 2026-07-19]` cwa workbook: F-005 = In Progress (rank 4), F-007 = Deferred
  (rank 2), both date_scored 2026-07-19; 0 of 7 rows Implemented on the ingest side.
- `[agent-discovery 2026-07-19]` `bff/src/events/catalog.ts:5-29`: 21 `admin.*` event names,
  5 of them `admin.user.*` (23.8%); relay fans out all 21 and the consumer filters (cwa spec
  `:248`).
- `[agent-discovery 2026-07-19]` Runbooks: 3 exist (F-002, F-004, F-005), 305 lines total;
  0 occurrences of "peer" in the F-004 runbook; 0 occurrences of secret/rotation/credential
  across all 3. Peer guidance lives only in `bff/src/relay/README.md:51,214,217,221`.
- `[agent-discovery 2026-07-19]` Test surface: 34 relay/event test files (20 `bff/test/relay/`,
  9 `tests/e2e/relay/tests/`, 5 `bff/test/events/`); 0 assert the exact outbound header set;
  1 containment-only assertion at `bff/test/relay/http-peer-transport.test.ts:105-113`; 40
  `HttpPeerTransport` constructions across 2 test files; the e2e fan-out journey runs at 2
  peers (`tests/e2e/relay/tests/fanout.e2e.test.ts:43`).
- `[agent-discovery 2026-07-19]` D-006 (GH issue #16, OPEN, 0 comments, created 2026-07-19):
  workbook status Prioritized, severity 2, reach 1, confidence 9, score 21.4, rank 7 of 18;
  its evidence field justifies reach on `EVENT_BUS_MODE=inproc` + empty `EVENT_BUS_URL`.
  Neither the issue nor the row records any dependency on peer expansion, cwa, or F-010.
- `[agent-discovery 2026-07-19]` Deployment state: `bff/.env:25` has `EVENT_BUS_MODE=inproc`
  and 0 `EVENT_BUS_URL` lines; `bff/.env.example:23-25` sets `EVENT_BUS_URL=` empty and
  documents 2 of 8 `EVENT_BUS_*` vars; 0 docker-compose / k8s / Dockerfile in-repo; config
  hard-refuses production boot on an empty peer list (`bff/src/relay/config.ts:27-34`).
- `[agent-discovery 2026-07-19]` Naming: cwa's spec pins the delivery-id header name exactly
  but names no header name and no env var name for the shared secret — described only as "a
  bearer token / shared-secret header," constant-time compared (cwa `:186-197,676-679`).
- `[agent-discovery 2026-07-19]` "October 2026": 28 matches across 14 files in both repos;
  conflicting characterizations at admin-console `specs/F-001-adhere-to-design-system.md:787-789`
  (hard compliance gate, F-001 scope) vs cwa `briefs/F-007-production-event-relay-twin.md:102-104,121,223`
  (internal goal, date open); 0 matches connect the date to F-010, the peer list, or the cwa
  ingest endpoint.

Evidence gaps worth stating plainly: no usage analytics, no support tickets, no customer
interviews, and no intake records bear on this row. All value-side evidence here is
code/spec-artifact evidence about a seam, not demand evidence.

## Proposed Direction — non-binding

One plausible shape: add cwa's ingest URL to the relay's `EVENT_BUS_URL` comma-list per
REQ-F005-060, and introduce a shared-secret credential path in the outbound transport so the
POST carries the envelope, `X-Event-Delivery-Id`, and the credential together per REQ-F005-061
— sourced from a new relay config key / env var, kept out of the envelope so REQ-F005-062's
freeze holds, and kept out of logs. Agree the credential's header name and env-var name jointly
with cwa first, since neither side has named them. Pair that with a runbook covering peer
registration, credential provisioning, and rotation, since no existing runbook mentions peers,
secrets, or rotation. Verification would likely lean on the existing e2e stub peer and a test
that asserts the exact outbound header set (none does today), plus an explicit check that a
401 from a peer classifies as permanent under REQ-F004-055 — so the parking behavior is a
known, documented outcome rather than a surprise in production. Nothing here is binding on
implementation.

## Out of Scope

- **Relay transport hardening — stays with D-006 (GH issue #16), per product-owner ruling
  2026-07-19:** HMAC or mTLS peer authentication, and https-only peer-URL enforcement. F-010
  ships the shared-secret credential that cwa's REQ-F005-061 requires and no more; it does not
  redesign the relay's authentication model.
- Building or modifying cwa's `/api/events/ingest` endpoint, or any cwa-side consumer logic —
  that is cwa F-005's scope.
- Changing the event envelope, the `admin.user.created` `changes` shape, or adding payload
  fields — frozen by REQ-F005-062.
- Changing the response classifier semantics established by REQ-F004-055.
- Broker-based transport, or any transport other than HTTP peers.
- Deployment topology artifacts (docker-compose / k8s / Dockerfile), which do not exist in-repo.

## Open Questions

1. **What is the credential's header name and env-var name, on both sides?** cwa's spec pins
   the delivery-id header exactly but names neither for the shared secret (cwa
   `:186-197,676-679`). This has to be agreed jointly with cwa before either side can implement
   against it; it is the single most likely source of a silent 401 loop.
2. **Can F-010 meaningfully ship — or be verified — before cwa's ingest endpoint exists?**
   The endpoint is spec-text only and cwa's F-005 is In Progress with 0 of 7 rows Implemented
   on the ingest side. Does "done" for F-010 mean verified against the e2e stub peer, or
   verified against a real cwa deployment? Who decides?
3. **What does October 2026 concretely require of this row?** 0 of 28 matches connect the date
   to F-010, the peer list, or the ingest endpoint, and the corpus carries two conflicting
   characterizations of the date itself. What is the concrete date, and what specifically must
   be true of this integration by then?
4. **Does peer-scheme validation (rejecting `http://`) belong here or with D-006?** Config does
   0 scheme validation today and all 3 README examples are `http://`. The Out-of-Scope ruling
   assigns https-only enforcement to D-006, but shipping a shared secret over a peer list that
   accepts plaintext `http://` is a combination worth an explicit decision rather than a
   default.
5. **How is the credential rotated, and who holds it?** No runbook mentions secrets or
   rotation, and there are 0 deployment artifacts in-repo, so the provisioning path is
   currently unspecified.
6. **How should a permanent park caused by one peer be operated?** Given that a permanent
   outcome from any not-yet-acked peer parks the ordering key for all peers, what is the
   expected operator response when cwa 401s or is down long enough to matter — and does that
   change the answer to Q4 or the D-006 boundary?
7. **Does D-006 need re-examination now that a second peer is contemplated?** Its recorded
   reach basis (`inproc`, empty peer list, transport inactive) would no longer describe reality.
   Flagged for the human who owns that row; no scoring proposal is made here.
