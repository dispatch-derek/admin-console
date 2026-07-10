# F-001 Pre-Migration `className` Inventory — Baseline of Record (2026-07-07)

Status: **static, dated historical record** — REQ-F001-009's "ad-hoc token/CSS baseline" and
REQ-F001-010's "one-off `className` usages" pinned count. This document is the contract of record for
"what F-001 started from"; it is captured once, at spec-authoring/inspection time, and is **never
re-derived from live disk** thereafter (see `web/tests/inventory/migration-completeness.test.ts`, first
describe block, which asserts only against THIS document's own content).

Recorded per human ruling (2026-07-09, Phase 4 follow-up): the original test suite locked this figure
against LIVE disk (`expect(count).toBe(143)`), which forbade the very componentization REQ-F001-019/-016
require (a correct migration SHRINKS the ad-hoc `className` count). The count is preserved here purely
as a dated baseline fact; the live tree is instead governed by REQ-F001-010's actual disposition/
accounting gate (second describe block in the same test file), which is count-independent.

## Baseline figures (as inspected 2026-07-07, spec REQ-F001-009/REQ-F001-010)

- **143** `className=` occurrences
- across **22** files
- under `web/src/` (the App shell, the five feature areas, the three shared components, and the auth
  screens — REQ-F001-012)

## The ~40 bespoke element/utility class selectors being migrated FROM (REQ-F001-009)

Extracted from the pre-migration `web/src/index.css` (~723 lines: a `:root` dark token block, a
`:root[data-theme='light']` light token block, a `@media (prefers-color-scheme: light)` fallback
block, and these bespoke rules):

```
app, app-loading, app-sidebar, app-brand, app-user, app-main,
sidebar-nav, sidebar-section, sidebar-section-label, sidebar-item, sidebar-footer,
page-header, page-description, page-body, page-loading,
field, field-error,
error-banner, success, warning, readonly-note, hint,
badge, badge-set, badge-notset, badge-active,
modal-overlay, modal, modal-actions, danger-target, danger-button,
entity-table, entity-list, member-list, document-list, checkbox-list,
recovery-codes, masked-diff, chat-list, link-button,
workspaces-view, list-column, list-header, detail-column,
create-workspace, workspace-settings,
settings-category, category-title, provider-groups, provider-group,
provider-group-header, provider-group-caret, provider-group-name, provider-group-body,
control-row, verify-ok, verify-pending, settings-actions,
auth-screen, auth-panel, mfa-qr, mfa-secret, mfa-uri,
user-list, invite-list, membership-panel, chat-oversight, knowledge-panel,
diagnostics-page, raw-editor, multi-user-disabled,
create-user, create-invite, add-member, doc-title, pin-on, pin-off, pager,
raw-actions, ollama-fallback, advanced-gate, primary-button
```

(This is the same enumeration retained in `migration-completeness.test.ts`'s `LEGACY_ADHOC_CLASSES`
constant, used there only to check `index.css` no longer *defines* these selectors post-migration —
not to gate live `className` usage, which is governed by the count-independent accounting test.)

## What supersedes this document going forward

- **REQ-F001-009** ("every rule in `index.css` accounted for") — checked live by
  `migration-completeness.test.ts`'s "index.css reduced to token layer + documented residual only"
  block.
- **REQ-F001-010/019/027** ("every `className` site accounted for; none unaccounted-for ad-hoc") —
  checked live by `migration-completeness.test.ts`'s className disposition/accounting gate, which is
  independent of this document's fixed count and remains valid however far the live count shrinks.

This document itself is never edited to match a shrinking live count — it is the frozen 2026-07-07
fact, cited by REQ-F001-009, and by the QA test that reads it.
