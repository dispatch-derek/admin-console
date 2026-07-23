# Runbook — F-010 relay peer registration + shared-secret credential

Spec: `specs/F-010-deliver-admin-events-to-customer-web-app.md` (rev 3) —
REQ-F010-003/007/016/017/018.
Composes with F-004: `specs/F-004-production-event-bus.md`
(REQ-F004-045/047/051/052/055) and its runbook `docs/runbooks/F-004-migration-runbook.md`.
Cross-repo consumer contract: `~/git/customer-web-app/specs/F-005-cross-app-identity-sync.md`
§3.6 (cwa REQ-F005-060..063).

F-010 registers customer-web-app (cwa) as a relay peer and adds one shared-secret credential to
every outbound peer POST. It introduces **no** new DB state and **no** extra network round-trip: the
credential rides the existing single POST per peer, as the HTTP header `X-Event-Ingest-Secret`, carrying
`EVENT_BUS_PEER_AUTH_TOKEN` byte-for-byte verbatim.

All config lives in the relay-scoped `EVENT_BUS_*` env family (`bff/src/relay/config.ts`); the
credential never touches the transport-agnostic drainer, the outbox, logs, errors, metrics, or
`/ready` (REQ-F010-008/011).

---

## (a) Registering a peer in `EVENT_BUS_URL`

Peers are the comma-delimited HTTP endpoints in `EVENT_BUS_URL` that the relay fans out to. The parse
rules are unchanged by F-010 (comma split, per-entry whitespace trim, empty entries dropped —
`config.ts`):

1. Obtain cwa's ingest URL (a deployment value, not a spec constant), e.g.
   `https://cwa.<env>.example.com/api/events/ingest`.
2. Add it to the relay's environment:
   `EVENT_BUS_URL=https://cwa.<env>.example.com/api/events/ingest`
   To register multiple peers, comma-join them:
   `EVENT_BUS_URL=https://peer-a/api/events/ingest,https://peer-b/api/events/ingest`.
3. Restart the relay. On boot the URL appears in `config.peerUrls` and `HttpPeerTransport` fans out to
   it. Removing the URL removes the peer on the next restart.

Security caveat (F-010 §8 Q4): the console performs **no** peer-URL scheme validation today — a
plaintext `http://` peer is accepted. Sending a shared secret over a plaintext peer is a live
exposure until D-006 (GH #16) adds https-only enforcement. Prefer `https://` peer URLs.

---

## (b) Provisioning the credential env var — and who holds it

The credential is sourced from the new relay-scoped env var `EVENT_BUS_PEER_AUTH_TOKEN`
(REQ-F010-007), read as a **raw single string** — it is **not** comma-split and **not**
whitespace-trimmed the way the peer list is, and it is delivered on the wire verbatim (REQ-F010-005).

- **Holder:** the **deployment operator** (§8 Q5). The credential is never committed to source or
  fixtures. `bff/.env.example` documents the key with an **empty** value only; a real secret is
  supplied at deploy time via the operator's local (gitignored) env.
- **Provisioning:** set `EVENT_BUS_PEER_AUTH_TOKEN=<the shared secret>` in the relay's environment.
  It must be the **same** secret cwa constant-time compares against on `/api/events/ingest` (cwa
  REQ-F005-061). The single secret is applied to **every** configured peer (REQ-F010-009); do not
  register an unrelated second peer against the same secret (disclosure risk, §8 Q7/Q9).
- **Boot posture (REQ-F010-017):**
  - Production + a peer configured + credential **absent or `""`** → the relay **refuses to boot**,
    naming `EVENT_BUS_PEER_AUTH_TOKEN`. This prevents a silent, self-inflicted 401 park loop.
  - A **whitespace-only** value (e.g. `" "`) is **not** empty — it boots and is sent verbatim. This
    is almost certainly a misconfiguration; treat a boot with a whitespace-only credential as an
    incident.
  - A credential containing any byte **illegal in an HTTP header field value** (CR, LF, NUL, or any
    other control byte — non-exhaustive) → the relay **refuses to boot** in **any** environment with
    a distinct "illegal byte" error, rather than sending a malformed request.
  - Development (`NODE_ENV != production`) + credential unset/empty → the relay **boots soft**;
    delivery to a credential-requiring peer will park per section (d).

---

## (c) Rotating the credential

Rotation is manual and must be **coordinated with cwa** to avoid a 401 gap (§8 Q5):

1. Agree the new secret with the cwa operator out of band.
2. Roll cwa to accept the new secret (cwa's window may accept both old and new during the cutover;
   confirm with the cwa operator).
3. Re-provision `EVENT_BUS_PEER_AUTH_TOKEN` with the new secret in the relay environment.
4. **Restart the relay** (the credential is read at boot).
5. Once cwa has cut fully to the new secret and the relay has restarted, retire the old secret on
   cwa.

If the relay restarts with the new secret **before** cwa accepts it, deliveries return 401 and park
permanently (section (d)) until the mismatch is resolved — no event is lost, but delivery stalls for
that ordering key.

---

## (d) Operator response to a permanent park caused by a peer

A peer that rejects the credential returns **401**, which classifies **permanent** under
REQ-F004-055. `HttpPeerTransport.deliver()` rejects permanent and the orchestration layer parks the
ordering key **immediately** — no backoff retries, `attempt_count` does not accumulate, and the park
counter (REQ-F004-025) fires. The event is **never dropped**; the parked row is retained and
queryable (REQ-F010-019).

Recovery (REQ-F010-018) — after fixing the root cause (re-provision the correct credential per (b),
or restore the peer):

1. Confirm the correct credential is provisioned and the relay has restarted.
2. Replay the parked rows for the affected ordering key using the F-004 park/replay machinery
   (clearing `parked_at` makes a row eligible again via `idx_outbox_eligible`'s
   `WHERE parked_at IS NULL`). No F-010-specific replay API exists.
3. On re-drive the peer now returns 2xx and the row publishes (`published_at` set). No envelope was
   lost or mangled.

**Partially-delivered parks (REQ-F004-051(e)/025):** with more than one peer configured, a row is
published only after **every** peer acks. If one peer 2xx-acks and another (e.g. cwa) returns 401,
the ordering key parks even though a peer already holds a copy. The relay surfaces this as a
**partially-delivered** park (distinct from a never-delivered park) so operators know an acked peer
holds a **dedupable** copy — the delivery id (`<epoch>:<row-id>`) lets that peer de-duplicate the
replay. Do not treat the replay as a fresh delivery to the already-acked peer.

---

## (e) Deployment-validation step — live delivery to the real cwa endpoint

cwa's `/api/events/ingest` is implemented (§8 Q2), so validate end-to-end against the **real cwa
deployment** after any peer/credential change (this is the REQ-F010-024 part-(b) verification,
executed here rather than as an in-repo automated test since cwa is a separate deployment):

1. Confirm `EVENT_BUS_URL` contains the real cwa ingest URL and `EVENT_BUS_PEER_AUTH_TOKEN` matches
   the secret cwa expects; the relay booted without refusing (section (b)).
2. Trigger a real `admin.user.*` state change in admin-console (e.g. create a user) so an
   `admin.user.created` envelope is enqueued and drained.
3. Confirm on the cwa side that the ingest endpoint **accepted** (2xx) the delivery — the request
   carried all three wire elements: the frozen envelope body, the `X-Event-Delivery-Id` header, and
   the `X-Event-Ingest-Secret` credential header.
4. Confirm on the admin-console side that the outbox row published (`published_at` set) and did not
   park.
5. If cwa returns 401, the credential does not match cwa's expected value — recheck (b)/(c) and the
   scheme caveat in (a); the row parks and is recoverable per (d).
