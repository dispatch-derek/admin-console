# Admin Console Design System

A design system for the **Admin Console** — an instance-management app for administrators and managers (Users, Workspaces, Invitations, Event Log, Agent Skills, System settings). It is being adapted from the open-source AnythingLLM project's admin surface into its own product with its own (not yet determined) branding; this system covers the **admin surface only**.

> **Scope: admin console only.** The end-user product (workspace chat, document manager, onboarding) is a separate app with its own distinct look and feel, and is intentionally **not** covered here — it should have its own design system. Do not extend this one to chat surfaces.

> **Branding: not yet determined.** No logo or brand name has been provided. "Admin Console" renders in plain type wherever a mark would go (see `guidelines/brand-logo.card.html`). Do not invent a logo — swap in the real one once it's chosen.

It exists so design agents can generate on-brand Admin Console screens, mockups, and prototypes without re-deriving the app's tokens, components, and layout rules.

## Sources
This system's tokens, components, and screens were derived from a real open-source codebase, kept here for provenance:
- **Codebase:** `frontend/` — the AnythingLLM open-source frontend (Vite + React + Tailwind). Ground truth for all tokens, components, and screens as originally recreated.
  - Tokens: `frontend/src/index.css` (`:root` and `[data-theme="light"]`), `frontend/tailwind.config.js`.
  - Screens recreated: `frontend/src/pages/Admin/*` (Users, Workspaces, Invitations, Logging), `frontend/src/components/Modals/Password/*` (login).
  - Primitives referenced: `frontend/src/components/lib/*` (CTAButton, Toggle), `frontend/src/components/SettingsSidebar/*`.
- **Font:** `frontend/public/fonts/PlusJakartaSans.ttf` (copied to `assets/fonts/`).
- Upstream project: AnythingLLM by Mintplex Labs (open source). The original AnythingLLM logo/wordmark files have been **removed** — this product is being rebranded independently and no new brand mark has been chosen yet (see the note above).

---

## Index / Manifest
- `styles.css` — global entry point (imports only). Consumers link this one file.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`.
- `assets/` — `logo/` (wordmarks + icon mark), `illustrations/`, `fonts/`.
- `components/` — reusable primitives (below).
- `ui_kits/admin-console/` — interactive admin console recreation.
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand).
- `SKILL.md` — Agent Skill wrapper.

### Components
Grouped React primitives (see `_ds_bundle.js`'s header comment for the exact `window.<Namespace>`):
- **forms/** — `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Toggle`
- **data-display/** — `Table` (+ `Table.Row`, `Table.Cell`), `Badge`, `PageHeader`
- **navigation/** — `SidebarItem`
- **overlays/** — `Modal`

**Intentional consolidation:** the source ships several one-off action buttons (`lib/CTAButton`, the white modal-confirm button, the ghost cancel button, the full-width login button). These are consolidated into one `Button` with `variant` = `cta | solid | ghost | danger | login`, since they share sizing and shape. `Toggle` merges the source's `Toggle` + `SimpleToggleSwitch`.

### UI Kits
- **admin-console** — Login → Users / Workspaces / Invitations / Event Log. See `ui_kits/admin-console/README.md`.

---

## CONTENT FUNDAMENTALS
How the Admin Console writes copy (inherited from the source product's admin surfaces):

- **Voice:** plain, direct, operational. It explains *what a screen is* and *what an action does*, often with the consequence spelled out. Page descriptions read like: "These are all the accounts which have an account on this instance. Removing an account will instantly remove their access to this instance."
- **Person:** addresses the operator in third person about the system and its users ("this user", "their access", "this instance"). Rarely "you"; never "we". "This instance" is the recurring noun for the deployment.
- **Casing:** **Title Case** for page/section titles and primary buttons at sentence-scale ("Add user", "New Workspace", "Clear Event Log"). Sentence case for descriptions and hints. Table headers are **UPPERCASE** + bold. System event names are `lower_snake_case` (`login_event`, `workspace_created`).
- **Tone on destructive actions:** blunt and explicit, with a warning + irreversibility note, usually via a native `confirm()`: "This action is irreversible."
- **Hints:** small secondary-colored helper text under inputs ("Password must be at least 8 characters long", username rules).
- **Emoji:** none in the admin console. Do not use emoji.
- **Vibe:** a developer/operator control panel — technical, dense, trustworthy, unfussy. Favor clarity over marketing polish.

Examples to emulate:
- Button: "Add user", "New Workspace", "Create Invite Link", "Clear Event Log".
- Description: "View all actions and events happening on this instance for monitoring."
- Empty state: "No pending invitations. Create a link to get started."

---

## VISUAL FOUNDATIONS

**Theme.** Dark-first. `#0e0f0f` app background, `#1b1b1e` raised panels. A full light theme exists under `[data-theme="light"]` (white/`#edf2fa` surfaces). Default and design here is dark.

**Layout.** App shell = a fixed **252px sidebar** (same `#0e0f0f` as the background) beside a **rounded-16px secondary panel** (`#1b1b1e`) that floats with ~16px margins (`ml-[2px] mr-[16px] my-[16px]`). Content padding is generous on the right (`pr-[50px]`). Pages open with a `PageHeader` (title + description + 2px bottom rule), then content.

**Color.** Neutral graphite base (inks, `#27282a` inputs, `#3f3f42` borders, `#4e5153` outlines) with a single **brand cyan** accent — primary `#46c8ff`, CTA `#7cd4fd`, home `#36bffa`, teal/light-primary `#0ba5ec`. Status colors: danger `#f04438`, error `#b42318`, warn `#854708`, success `#05603a`, plus purple `#4a1fb8` and magenta `#9e165f`. Accents are used sparingly — mostly on primary buttons, links, focus rings, and badges; the field is neutral.

**Type.** One family: **Plus Jakarta Sans** (variable, 200–800; used 400/500/600/700). The console is compact — body/table text is **12px**, form labels 14px, section titles 18px bold, modal titles 20px, and the login hero 38px/500. Table headers are 12px uppercase bold in secondary color.

**Spacing.** 4px base grid (Tailwind scale). Common: 8/12/16/24px.

**Radii.** Heavily rounded: **16px** app shell, **8px** buttons/inputs/cards (the workhorse), **12px** larger cards/metadata rows, **6px** sidebar items, **full** pills for badges, toggles, avatars.

**Borders & elevation.** Elevation is subtle — the system leans on **hairline borders** (`rgba(255,255,255,0.1)`) and faint shadows rather than heavy drop shadows. Modals use a 2px `#3f3f42` border + soft shadow. Table rows are separated by 1px hairlines, not fills. Cards = surface fill + hairline border + small radius (no colored left-border accents).

**Backgrounds.** Flat solid fills. The signature decorative treatment is a set of **neutral graphite gradients** (not colorful): main `180deg #3d4147→#2c2f35`, sidebar `90deg #5b616a→#3f434b`, selected `146deg`. Used on gradient buttons, selected sidebar/workspace items, avatars. No photographic imagery, no textures, no colorful hero gradients.

**Buttons & states.**
- Primary CTA: cyan `#46c8ff` pill, dark text, 34px tall; hover → `#2c2f36` fill + white text.
- Confirm (modal): white fill, black text; hover → opacity 0.6.
- Ghost (cancel/row actions): transparent; hover → faint white fill (`rgba(255,255,255,.08)`). Row action verbs tint on hover (Suspend → orange, Delete → red).
- Focus: 2px cyan outline on inputs; login uses a 1px `sky-300` ring.

**Toggles.** Track is zinc (`#71717a`) off, **green** (`#4ade80`) on; white knob slides. Sizes sm/md/lg.

**Badges.** Fully-rounded pills, translucent tinted fill (`color/20`) + bright text (`color-400`), 12px. Event-log tone logic: login/create → green/blue, update → yellow, failed/deleted → red.

**Animation.** Restrained and quick. Fades and short slide-ups (`fade-in .3s`, `slide-up .4s ease-out`), a subtle `pulse-glow`, transitions of ~200–300ms on hover/expand. A playful chat-message pop (`scale` with slight overshoot) exists in the chat surface. No long or looping decorative motion in admin.

**Transparency & blur.** Overlays use `rgba(0,0,0,0.5)` backdrops. Layered fills use white-alpha (`/5`, `/10`) for hover and subitem states. Backdrop blur is not a core motif.

---

## ICONOGRAPHY
- **Icon system:** [Phosphor Icons](https://phosphoricons.com) — the product uses `@phosphor-icons/react` throughout (`House`, `Gear`, `Flask`, `UserPlus`, `Trash`, `CaretRight`, `X`, `LinkSimple`, `Info`, `List`, etc.). Line/regular weight is the default; **bold** weight is used for emphasis (close X, CTA leading icons, carets).
- **In this design system** (HTML cards, UI kits) icons are loaded from the Phosphor **web font** via CDN — `@phosphor-icons/web` regular + bold — e.g. `<i class="ph ph-users-three" />` and `<i class="ph-bold ph-x" />`. This is the same icon set as the source, delivered as a font for static HTML. If you build production React, use `@phosphor-icons/react` instead.
- **No emoji.** No unicode-character icons. No custom hand-drawn SVG icon set.
- **Brand marks:** none yet. The original AnythingLLM wordmark/icon files have been removed since this product is being independently rebranded and no new mark has been chosen. Every place a logo would go (sidebar, login screen) currently shows **"Admin Console" in plain type** — see `guidelines/brand-logo.card.html`. Do not draw a placeholder logo; swap in the real mark once provided. Illustration asset retained: `assets/illustrations/community-hub.png` (from the source product; unbranded).

---

## Usage
Link the tokens, then use components from the global namespace (see `check_design_system` for the exact suffix):
```html
<link rel="stylesheet" href="styles.css" />
<script src="_ds_bundle.js"></script>
<script>const { Button, Table, Modal } = window.<Namespace>; // see check_design_system / _ds_bundle.js header for the exact name</script>
```
Each component directory has a `<name>.card.html` showing live variants, a `.d.ts` props contract, and a `.prompt.md` usage note.

## Caveats
- **Fonts:** Plus Jakarta Sans is the **real** product font (copied from the codebase) — no substitution.
- **Icons:** delivered via the Phosphor **web font** for static HTML (the app uses the React package of the same set).
- Light theme tokens are included but the system is designed and demonstrated in dark.
