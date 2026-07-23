# SECURITY REVIEW REPORT — F-010 (deliver admin events to customer-web-app)

- Date: 2026-07-22
- Reviewer: application security review (defensive)
- Branch: `spec/f-010-deliver-admin-events-to-cwa` vs `main`
- Verdict: **PASS WITH NOTES** (no Critical/High findings)

## Scope

Shared-secret credential added to the relay's outbound HTTP peer POST.
Files reviewed (diff `main...HEAD`):

- `bff/src/relay/config.ts` (new `EVENT_BUS_PEER_AUTH_TOKEN`, boot validation)
- `bff/src/relay/http-peer-transport.ts` (attaches `X-Event-Auth-Token`)
- `bff/src/relay/transport.ts` (threading via `createTransport`)
- `bff/src/relay/index.ts` (wiring)
- `bff/src/relay/drainer.ts`, `ready.ts`, `metrics.ts` (leak-path review, unchanged by diff)
- `bff/.env.example`, `docs/runbooks/F-010-peer-registration-and-credential.md`
- Committed test fixtures under `bff/test/relay/` and `tests/e2e/relay/`

Scanners run: manual data-flow trace + targeted grep (no repo-configured SAST for this slice;
`npm audit` not run — the diff changes no dependencies, see Not assessed).

## Verification performed (empirical)

- **Secret leakage — clean.** `peerAuthToken` is referenced in exactly four places
  (`config.ts` read/validate/export, `transport.ts` thread-through,
  `http-peer-transport.ts` header set, `index.ts` wiring). It never reaches a log sink.
  The only log sinks in the relay are `console.error('[relay] drain tick failed:', err)`
  and the prune-failure log (`index.ts:65,74`); `err` there is a `TransportError` (or
  drainer error) whose message is a **static literal** — the token is never interpolated.
- **`TransportError` — clean.** Both throw sites (`http-peer-transport.ts:110,114`) use
  fixed strings; the class (`transport.ts:18-34`) stores only `classification` + `partialAck`.
  Fetch/network errors are swallowed by the inner empty `catch` (`http-peer-transport.ts:90`)
  and mapped to `'transient'`, so no undici error object carrying header data can propagate.
- **`event_outbox` — clean (REQ-F010-020).** The only write of error text to the outbox is
  `outboxRepo.setLastError(row.id, errText(err))` (`drainer.ts:80`), and `errText`
  (`drainer.ts:45`) returns `err.message` — the static `TransportError` message. Token cannot
  land in `last_error`.
- **`/ready` & metrics — clean.** `buildReadyApp` receives only booleans/thresholds
  (`index.ts:43-52`); `eventBusUrlConfigured` is a `length > 0` boolean, not the URL/token.
  Metrics expose backlog/lag only. The transport instance (whose `peerAuthToken` is a
  runtime-enumerable own property despite the TS `private`) is never logged or serialized.
- **Envelope freeze — clean (REQ-F010-010).** The token is transport-only; it is never passed
  to the envelope builder and the transport delivers `envelope` byte-for-byte. Confirmed by
  the committed `bff/test/store/f010-no-new-outbox-state.test.ts` and confidentiality suite.
- **Header injection — mitigated (REQ-F010-017).** `ILLEGAL_HEADER_VALUE_BYTE =
  /[^\t\x20-\x7e\x80-\xff]/` (`config.ts:49-55`) fail-fasts at boot on CR/LF/NUL and any other
  C0 control/DEL, environment-independent. CRLF request-splitting via the credential is blocked
  before the value can reach `fetch`. The header **name** is a constant; the only other wire
  header value from this feature is the pre-existing `deliveryId`. No new unvalidated wire path.
- **Boot posture — correct.** Production fail-fast when a peer is configured but the credential
  is unset/empty (`config.ts:63-68`) prevents the silent 401 park loop; cannot be bypassed
  except by leaving `NODE_ENV !== 'production'`, which is the intended dev-soft posture.
- **Env/secret hygiene — correct.** Token sourced from `process.env` only; `.env.example`
  documents the key with an **empty** value and a "never commit a real secret" note.
  `relay/config.ts` deliberately does not import the BFF engine/auth config (verified header
  comment + no import), so it does not drag in `SESSION_SECRET`/`SECRETS_ENC_KEY`.
- **Committed fixtures — no real secret.** Test tokens are obvious throwaways
  (`e2e-correct-secret-DO-NOT-REUSE`, `a-different-configured-secret`). A negative assertion
  (`credential-auth.e2e.test.ts:180`) even pins that boot stderr must **not** contain the secret.
- **No dependency changes** in the diff (no `package.json`/lockfile delta).

## Findings

### [Informational] Whitespace-padded credential is not delivered byte-for-byte "verbatim"
- File: `bff/src/relay/http-peer-transport.ts:78-79`; contract asserted in `config.ts:59` and
  the `.env.example` note ("Read verbatim (no trim/split)").
- Detail: WHATWG Fetch normalizes header values by stripping leading/trailing HTTP whitespace
  (0x09/0x0A/0x0D/0x20) before transmission. A token configured with leading/trailing spaces
  (or the documented single-space `' '` "non-empty, delivered verbatim" case) will reach the
  peer **trimmed**, contradicting the "verbatim" guarantee in the code/spec comments.
- Impact: none security-wise — no leak, no injection. Worst case is a functional mismatch
  (peer sees a different value than the operator set → 401 → row parks). Flagged for
  implementer/spec awareness only; not a vulnerability.
- Remediation: none required for security. If verbatim delivery of whitespace-padded tokens is
  actually contractual, document the Fetch-normalization caveat or forbid leading/trailing
  whitespace at boot. Otherwise adjust the comments to stop over-promising "verbatim".

### [Informational — already tracked] Plaintext `http://` peer exposure of the shared secret
- The relay attaches the credential to whatever peer URLs `EVENT_BUS_URL` lists, and config does
  no scheme validation, so a misconfigured `http://` peer would carry the secret in cleartext.
- This is the KNOWN, product-owner-accepted scope boundary assigned to **D-006 (GH #16)** and
  separately logged as **D-007 (GH #39)**. Recorded here for traceability; NOT a new finding and
  NOT a blocker for F-010.

## Not assessed

- `npm audit` / SAST not executed: the F-010 diff introduces no dependency or lockfile changes,
  so a supply-chain scan was out of scope for this slice. (Repo-wide `web/package-lock.json` is
  modified in the working tree but is unrelated to this branch's diff.)
- Runtime behavior of the peer (customer-web-app) verifying the credential is out of scope
  (separate repo/feature); only the relay's send-side handling was reviewed.
- Peer TLS/scheme enforcement — deferred to D-006/D-007 as noted above.

## Verdict

**PASS WITH NOTES.** No Critical/High/Medium findings. Credential handling is confined to the
transport seam with correct boot-time header-legality and empty-credential fail-fast, and no
leak path was found into logs, `TransportError`, `/ready`, metrics, the envelope, or
`event_outbox`. Two informational notes above; neither blocks merge.
