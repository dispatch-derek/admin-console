# F-001: Adhere to a Design System

## Problem
The Admin Console's UI is assembled ad hoc, with no shared design system governing it. Styling lives in a single ~723-line `web/src/index.css` of CSS custom properties hand-lifted from the AnythingLLM instance's theme, applied through ~143 hand-written `className` usages across five independently built feature areas (users, workspaces, settings, raw editor, diagnostics), with only three shared UI components (`DangerConfirm`, `ErrorBanner`, `SetNotSetBadge`) factored out. Without a governing system, visual and interaction patterns are free to diverge between feature areas, there is no single source of truth for color/spacing/typography/component behavior, and every new screen re-decides styling choices from scratch. The people who experience this are our internal staff operators, who work across all five areas daily; the result is an inconsistent, unsystematized operator surface rather than one that reads as a single, coherent, professional product. There is also no mechanism today to stay in sync with an evolving external design source: because styling is hand-authored per screen, any future refresh of the intended look would have to be re-applied manually, screen by screen.

*(Note: evidence here is currently the observable state of the codebase plus conviction — no support-ticket or usage-analytics signal was gathered, since no discovery scan was run. This is honest thinness, not a gap being hidden.)*

## Affected Users
Internal staff/operators are the entire user population — this is a staff-only administration tool; customers do not see it directly. Every operator touches all five feature areas, so 100% of the user base is exposed to the inconsistency on essentially every session. The absolute size of the operator base is not yet established (see Open Questions), which bounds how large "reach" actually is: high frequency and full-coverage exposure, but across a small internal audience rather than a customer population.

## Business Rationale
Stated as falsifiable claims for later verification:
- **Engineering velocity:** a reusable component/token system should reduce the per-screen cost of building and changing UI, speeding feature delivery. Falsifiable by measuring UI-change effort before/after adoption.
- **Maintenance cost:** consolidating ~723 lines of bespoke CSS and scattered `className` decisions into a governed system should lower ongoing styling maintenance and reduce UI-inconsistency defects. Falsifiable by tracking styling-related churn and UI bug counts.
- **Durable design-currency (ongoing, not one-time):** Claude Design is expected to ship ongoing updates; adopting it so the frontend can pull those updates in cheaply keeps the console visually current at low marginal cost over time, rather than paying a fresh redesign tax each time the design evolves. Falsifiable by measuring the effort to absorb a *subsequent* Claude Design update after initial adoption.
- **Internal credibility / professional impression:** a coherent, polished operator surface strengthens how the console reads to internal stakeholders around the October 2026 go-to-market. *Caveat:* the original rationale framed this as an impression on "our customers," but the tool is staff-only — so unless there's a customer-facing exposure path (demos, screen-shares; see Open Questions), the "impression" benefit accrues to internal/staff perception, not customers directly. The customer-facing framing should not be leaned on until that path is confirmed.

## Timing
Tied to the **October 2026 go-to-market** (~3 months out from 2026-07-07). The console being design-system-compliant is wanted for GTM readiness. The cost of waiting compounds: every feature area shipped or extended before adoption accrues more ad-hoc styling that later has to be retrofitted onto the system, so the retrofit surface grows the longer adoption is deferred past GTM. Whether GTM is a hard compliance gate or a soft target is not yet confirmed (see Open Questions).

## Existing Evidence
Pointers only — leads to be re-verified at scoring time, not established fact:
- **Claude Design project (the system to adopt):** `https://claude.ai/design/p/4c97b85d-5482-401b-b1b3-12df2a9d8d66`, importable via the `claude_design` MCP (`https://api.anthropic.com/v1/design/mcp`, auth via `/design-login`). This is the already-owned design system this feature would apply; its exact coverage (tokens vs. full component set, light+dark, which console patterns it covers) is unverified — see Open Questions.
- **Current-state baseline (internal):** `web/src/index.css` (~723 lines, AnythingLLM-derived theme variables, dark default + `[data-theme="light"]`), ~143 `className` usages, three shared components under `web/src/components/`. Cited as the "no system today" baseline.
- **General-industry benefit claims (low project-specificity):** Toptal, Ionic, and Forrester articles on design-system benefits (carried from the workbook's evidence field). These argue the category in general; they are not evidence about this console's specific problem or payoff.
- **Not gathered:** no support-ticket, operator-interview, or usage-analytics signal — no discovery scan was run for this brief.

## Proposed Direction
*(Non-binding sketch.)* Import the existing Claude Design project via the `claude_design` MCP and adopt its tokens and components as the console's governing system, mapping them onto the five feature areas and replacing the ad-hoc AnythingLLM-derived CSS and one-off `className` styling with the system's primitives. A phased, area-by-area migration (rather than a single big-bang rewrite) is one plausible shape that could de-risk the path to GTM, but the sequencing is left open for effort estimation. The adoption should be structured so future Claude Design updates flow through with minimal rework — consuming the system as a maintained, re-importable source (via the `claude_design` MCP) rather than a one-time copy that immediately begins to drift.

## Design Considerations
*No formal UX-designer read was run for this brief (the optional design read was not requested), so this is an author-level framing that informs — but does not set — the human's later Effort and Risk scores:*
- **Complexity read (informational):** this is largely a *systematization/migration* of existing surfaces rather than net-new flows — it touches every screen but changes what they're built from, not what they do. Complexity is dominated by breadth (five feature areas, ~143 styling sites) and by how cleanly the Claude Design system's components map onto existing patterns the console already relies on (data tables, danger-confirm modals, set/not-set badges, settings forms, the raw editor).
- **UX-risk read (informational):** the console today supports both dark (default) and light themes; risk hinges on whether the imported system covers both and preserves the existing operator workflows without behavioral regressions. Accessibility posture (e.g., a WCAG AA commitment) is unconfirmed and is a live risk input. A one-time copy would begin diverging from Claude Design the moment it's made; keeping re-sync cheap is a primary design goal, which raises the bar on *how* components are consumed (composition over forking) and is itself an effort/risk input.

## Out of Scope
- Any change to AnythingLLM's own customer-facing application or its native theme.
- Net-new console features or changes to operator functionality/behavior — this is styling/component systematization, not new capability.
- Backend/BFF changes.
- Redefining the brand itself — this feature *applies* the existing Claude Design system, it does not author a new brand.

## Open Questions
- What exactly does the Claude Design project contain — design tokens only, or a full component set? Does it cover the console's specific patterns (tables, danger-confirm modals, badges, settings forms, raw editor)?
- Does it define both light and dark themes, matching the console's current dual-theme support?
- How does Claude Design publish updates — versioned releases? — and does the `claude_design` MCP support re-import/sync of an already-adopted project? What update cadence should we plan for? (Bears on how "easy future adoption" is designed, and on ongoing effort.)
- Is there any customer-facing exposure path (demos, screen-shares, screenshots) that would make the "professional impression on customers" rationale real, or is it strictly internal?
- What is the size of the internal staff/operator user base (bounds reach)?
- What accessibility standard does the design system commit to (e.g., WCAG 2.1 AA)? (Informs risk.)
- Is October 2026 GTM a hard compliance gate or a soft target for the console?
- Is a phased, area-by-area migration acceptable, or is full compliance needed at once? (Bears on effort.)
