# F-009: Console login for console-created admin users

## Problem
The admin console runs two fully separate identity planes. Console operators
("staff") live in the BFF sqlite `staff` table and are the only identities that
can authenticate against console login (`POST /api/auth/login`,
`bff/src/routes/auth.routes.ts:133`, which resolves only
`staffRepo.findByUsername`). Product users created through the console's Users
screen (`web/src/features/users/UserList.tsx` → `POST /api/users` →
`bff/src/services/user.service.ts:101`) are written to the AnythingLLM engine's
own DB only; no staff row is created, and the BFF records only an audit_log row
and an `admin.user.created` event envelope.

The Users screen offers a role choice that includes "admin". Firsthand, on
2026-07-19, the deployment's operator created admin-role users through the
console UI expecting those people to be able to log into the console. None can.
The "admin" role on that screen grants engine-side privileges only, but reads to
the operator as if it grants console access. Only the original first-boot
bootstrap account (`bff/src/auth/bootstrap.ts`, seeded once from
`ADMIN_BOOTSTRAP_USERNAME`/`ADMIN_BOOTSTRAP_TOKEN`) can log into the console.

There is no path in the shipped web UI to give a second person console access at
all: `web/src/api/client.ts` exposes `listStaff`/`createStaff` functions, but no
page under `web/src/features/` consumes them (features present: users,
workspaces, settings, baseline-prompt, diagnostics, featureToggles, raweditor —
no staff feature). In practice the only supported way to add a console operator
is hand-rolled API calls against `POST /api/staff`. The observed effect is that
the operator's expectation of console access for admins created via the UI is
silently unmet, and each deployment is left dependent on a single bootstrap
credential.

## Affected Users
Operators of each single-tenant deployment. Each deployment is a separate
install of the console; today one deployment is known, and its operator hit this
directly. The problem lands on every operator beyond the first person per
deployment, on every attempt to onboard an additional console user through the
UI. A secondary exposure is a bus-factor-of-one on console access per
deployment: if the single bootstrap credential is lost, console access is gone
until DB surgery or a re-bootstrap. Frequency is tied to onboarding events
(adding operators) rather than daily use.

## Business Rationale
Stated falsifiably: with the current behavior, a deployment cannot add a second
console operator through any shipped UI path, so any deployment that needs more
than one operator either performs manual API calls or cannot self-serve at all;
and loss of the sole bootstrap credential locks a deployment out of its console
until manual DB intervention. If those two claims are false — e.g., if operators
in fact never need a second console login, or a supported non-UI path is
considered acceptable — the business case weakens accordingly. No revenue,
retention, or contract figures tied to this were supplied this session; the
argument rests on operator self-service and the single-point-of-failure on
console access, not on quantified financial impact.

## Timing
ASAP — stated by the product owner on 2026-07-19 as a blocker for go-to-market.
Until console-created admin accounts can log in, the admin console cannot be
properly tested under multiple distinct admin accounts, so multi-operator
testing and the go-to-market readiness that depends on it are gated on this
feature. No external regulatory or seasonal date; the driver is the product's
own launch readiness.

## Existing Evidence
Pointers only; all human-supplied or code-verified this session. No ticket-system
entries are known to exist. Nothing here was produced by an agent-discovery pass.

- Firsthand operator report, 2026-07-19 (this session): console-created admin
  users cannot log into the console; only the bootstrap account works.
- Code: `bff/src/routes/auth.routes.ts:133` — login resolves only
  `staffRepo.findByUsername`.
- Code: `bff/src/services/user.service.ts:101` — `createUser` writes to the
  engine only (`POST /admin/users/new` via `bff/src/engine/adapter.ts`); no
  staff row created.
- Code: `bff/src/auth/bootstrap.ts` — single seeded account path from
  `ADMIN_BOOTSTRAP_USERNAME`/`ADMIN_BOOTSTRAP_TOKEN` (REQ-019a).
- Code: `bff/src/auth/staff.service.ts` — `createStaff` (credential-less account
  + one-time temp token, forces set-password + MFA enroll); its header notes the
  staff store is "BFF-store only — no engine calls".
- Code absence: no staff-management feature under `web/src/features/`;
  `listStaff`/`createStaff` exist in `web/src/api/client.ts` but are unconsumed
  by any page.
- Design/architecture docs under `docs/` describe the two-plane split (staff
  store vs engine users) as intentional.
- Contract note: the `admin.user.created` event envelope is frozen under F-004
  (REQ-F004-004).

## Proposed Direction
Non-binding. Reflects decisions ruled by the product owner on 2026-07-19 as the
chosen shape. When a user is created via the console with role=admin,
additionally provision a linked staff row seeded with the same password entered
in the existing create-user form, so the operator hands over one credential.
Console login still forces TOTP MFA enrollment on that person's first console
login: in this model `must_set_password` stays 0, but the existing MFA-enrollment
gate applies as it does today to any staff row lacking `mfa_enrolled`. Lifecycle
must be coupled: demoting an admin to manager/default, suspending the engine
user, or deleting the engine user must revoke or disable the linked console
staff account, so no orphaned console operators remain (an authz hole
otherwise); reactivation/re-promotion semantics need definition. Username
collisions with existing staff rows (e.g., a console-created admin sharing the
bootstrap account's name) must be handled. The provisioning path must be
audited; because the `admin.user.created` envelope is frozen (F-004,
REQ-F004-004), any new signal must be a new event name or a backward-compatible
addition, never a mutation of the frozen envelope. This reuses the existing
create-user form and login flow unchanged — no new user-facing surface — which
is why no Design Considerations section is included.

## Out of Scope
- Building a full staff-management UI screen.
- Changing the login or MFA flows.
- Delegating console authentication to the engine.
- Syncing manager/default (non-admin) users into the staff store.
- Multi-tenant or central-plane concerns.
- Retroactively provisioning staff rows for admin users created before this
  feature ships (raised instead as an Open Question).

## Open Questions
- Retroactive backfill: should pre-existing engine admins created before this
  feature ships get staff rows, or only admins created afterward?
- Reactivation semantics: when a demoted admin is re-promoted to admin, re-enable
  the same (disabled) staff row, or provision a new one?
- Password-change propagation: after creation, do the engine user's password and
  the staff row's password stay in sync (e.g., on engine-side password reset), or
  are they allowed to diverge by design?
- Collision policy: on a username collision with an existing staff row, reject the
  create, suffix the name, or link to the existing staff row?
- Guardrail interaction: how should the existing last-enabled-staff guardrail in
  `staff.service.ts` interact with lifecycle-driven disables — e.g., demoting the
  admin whose staff row is the last enabled console account?
