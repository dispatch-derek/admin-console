---
name: admin-console-design
description: Use this skill to generate well-branded interfaces and assets for the Admin Console, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files (tokens/, components/, ui_kits/, guidelines/, assets/).

The Admin Console is a dark-first, developer/operator control panel. Key rules of thumb: single family **Plus Jakarta Sans**; compact scale (12px body/tables, 18–20px titles); neutral graphite surfaces (`#0e0f0f` app, `#1b1b1e` panels) with one **cyan** accent (`#46c8ff`); 8px workhorse radius / 16px shell; hairline borders over heavy shadows; Phosphor icons; no emoji; blunt, operational copy in Title Case with UPPERCASE table headers.

No final brand mark has been chosen yet — "Admin Console" renders in plain type wherever a logo would go. Do not invent or draw a logo.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view — load `styles.css`, `_ds_bundle.js`, and the Phosphor web font, then use components from `window.<namespace>` (see `check_design_system` in-project, or the comment atop `_ds_bundle.js`, for the exact namespace). If working on production code, copy assets and read the rules here to become an expert in designing with this brand (use `@phosphor-icons/react` for icons).

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
