# Paper Trail: design review and next passes

Reviewed 2026-11-16 (America/Chicago). This document separates the implemented interaction fixes from proposed product work. Preserve the dark room, single light, paper and yarn; make the evidence legible, navigable and citable.

## Scope and evidence

- Manually inspected the live board and Ro Khanna case file, reproduced the overlapping featured slip and missing outside-dismiss behavior, and inspected the live New, Cases, Organisations, Timing, Saved, Following and Connections entry pages in Chrome.
- Manually inspected the revised board and evidence drawer on the local sample build. Automated Chromium checks cover desktop and phone layouts, section navigation, scrolling, drawer focus/dismissal, selected-tie navigation and board resizing.
- Reviewed the route/component map, table styles, layout code and existing product plan. The remaining route recommendations below are design proposals informed by that code/documentation, not claims of exhaustive manual testing.
- Sample data is invented. These checks establish interaction behavior, not the accuracy of production financial records. No new data model, political inference or coverage claim is introduced.

## Implemented in this pass

| Problem | Change | Reason |
|---|---|---|
| Featured briefing covers pinned cards | Place the paper briefing in normal flow above the canvas; make “Why this example?” expandable | Every card gets usable board space, regardless of explanation length |
| Dense boards can still collide | Keep successful placements; retry bounded, deterministic ellipse phases only when collisions remain | Avoid expensive continuous layout and preserve stable successful arrangements |
| Case/Full file shortcuts disappear far down the page | Sticky, horizontally scrollable section shortcuts, plus “Back to sections” links | Reach any section without scrolling through thousands of records |
| A trade table traps scrolling at its boundary | Restore native vertical scroll chaining | Wheel/touch scrolling can continue onto the document at the table's top/bottom |
| Evidence only closes through a small X | Outside-click dismissal, a labeled 44px close control, existing Escape support | Make dismissal discoverable on desktop and touch screens |
| Dismissal can interfere with other controls | Preserve focus on clicked controls; restore the opener for blank-area/explicit dismissal; retain evidence when switching views | Search, keyboard use and the shared investigation URL keep working |
| Paper buttons look disabled | Use ink-colored labels/borders and visible focus rings on paper | Distinguish available actions from disabled controls |
| Duplicate tooltip obscures the board while evidence is open | Suppress the board tooltip while inspecting a tie | One readable explanation at a time |
| Yarn can freeze at old geometry after view changes | Ignore hidden-canvas measurements and remove finished SVG animations | Resized/restored boards draw strings at current card positions |

The section links use native anchors and CSS sticky positioning. Scrolling uses browser behavior, with no wheel interception. The expandable explanation uses native details/summary. No new dependency or continuous animation loop is introduced.

## Design direction

Use the room as atmosphere and the paper as the working surface. Give each screen a clear sequence: subject, question, evidence, source, next action. The lamp should guide focus without making unselected text unreadable. Keep red for ties; use neutral borders, typography and patterns for selection, uncertainty and party distinctions.

Make the first screen answer three questions: “Whose file is this?”, “What am I looking at?”, and “Where is the original record?” Preserve amounts as ranges, distinguish household ownership, and keep coverage limits beside the quantities they qualify.

## Prioritized next work

| Priority / effort | Recommendation | Observation or rationale | Acceptance criteria |
|---|---|---|---|
| 1 / medium | Reorder the evidence drawer around a compact source summary | The source-record list sits below amounts, charts and explanatory sections | The filing source and a route to its records are visible without a long scroll; multiple-source ties are not misrepresented by one arbitrary link; coverage remains visible |
| 1 / small | Simplify Timing's repeated introductory explanations | The live page repeats elapsed-day caveats in “Read this first” and “How it is measured” before reaching results | One concise visible caveat; detailed methodology expandable; first chart visible sooner; no compliance claims introduced |
| 1 / medium | A shared table toolbar and optional column presets | New and Full file show many columns; similar-looking trade rows can be hard to distinguish | Essential/reporting column presets, explicit filtered/total counts, persistent sort direction, easy reset, record identifiers on demand; preserve virtualization and all downloadable fields |
| 1 / medium | Audit contrast and keyboard/touch targets across the whole product | Paper controls needed explicit ink colors; compact controls vary across routes | Automated accessibility checks plus keyboard, screen-reader and touch review; readable 200% zoom; do not claim compliance from automation alone |
| 2 / medium | Make the existing investigation tools easier to find | Save, Following and Connections exist, but require readers to discover separate entry points | A short “Investigate” flow from member/organisation pages: inspect → compare/connect → save → export; user testing confirms first-time readers can complete it |
| 2 / small | Add a useful saved-board starter state | Saved explains browser-only storage clearly, but starts with an empty name field and import control | Offer a clearly marked example or “Start from a member” action; keep local-storage and backup guidance; never mix tutorial items into real research silently |
| 2 / medium | Make filters visible as a single investigation summary | Years, families, assumptions and date basis already synchronize across views | Show active restrictions and clear/reset controls consistently; preserve them in navigation, citations and export; explicitly distinguish “no matching records” from “not covered” |
| 2 / medium | Improve discovery by year and geography | Organisation rankings are explicitly all-years/current-member views; Cases has limited filter dimensions | Add supported year/state filters with consistent denominators and clear ranking definitions; compute from appropriate data rather than filtering all-years totals misleadingly |
| 2 / small | Reduce repeated dense prose in Cases and long committee lists | Cases repeats limitations per card; the member committee panel has a capped scroll area | Keep the essential limitation visible once per section with accessible detail per result; make long committee lists expandable; preserve meaning in print/export |
| 3 / medium | Add a source-first, optional guided example | The featured board already explains why it was selected | A short dismissible walkthrough ends at an original filing and demonstrates the limits of a tie; no account, autoplay or mandatory tour |
| 3 / medium | Refine graph labels and comparison modes | Pinned cards truncate long organisation names; the inspector supplies detail | Full names available on focus/tap, stable card positions while inspecting, useful keyboard traversal, and equivalent record access in table mode |
| 3 / medium | Present saved investigations as an editorial workspace | Saving, notes, comparisons and exports already exist | Clear distinction between filed facts and private notes, an obvious backup/export action, and deliberate share previews showing what is included |
| 3 / small | Polish share and embed presentation | RSS, embeds and share images already exist | Show subject, time window, source/build date and limitations on every shared artifact; test a real newsroom iframe and feed reader |

Effort describes relative size, not a delivery estimate. These are follow-ups, not unfinished code in this branch.

## Route review map

| Area | Keep | Next design question |
|---|---|---|
| Board | Yarn, source-backed cards, featured selection, table alternative | Can a new reader identify one tie and open its record without help? |
| Case file | Subject summary, contextual coverage, synchronized view state | Can a reporter move between summary and detailed evidence without losing their place? |
| Full file | Virtual tables, column filters, CSV/JSON and citations | Can a reporter tell exactly which rows and fields an export includes? |
| New | Public-availability date basis and explicit 60-member bound | Can a local reporter narrow to their delegation and distinguish similar records? |
| Cases | Explicit definition and “not a finding” wording | Can ranking and common-year context be understood at a glance? |
| Organisations / Wall | Reach versus dollars, neutral party patterns | Are denominators and year scopes comparable before readers compare rankings? |
| Timing / Changes | Observed delays and explicit amendment distinctions | Can the result be understood before the reader studies its methodology? |
| Connections | Bounded search, statistical/hub exclusions, per-hop records | Can a reader explain what a path establishes and what it does not? |
| Saved / Following | Browser-only storage, explicit sharing limits | Can a first-time reader create, back up and revisit a useful investigation? |
| Method / Status / Export / Embed | Source documentation, freshness, reproducible artifacts | Are these trust tools reachable at the exact point a reader needs them? |

## Dynamics and performance

- Animate only meaningful transitions: selecting a card, changing a year window, opening an inspector. Keep an immediate reduced-motion version. Avoid a cursor-following spotlight that dims evidence or requires constant repainting.
- Keep layout deterministic and memoized. The expanded geometry sweep tested 6,048 combinations with no collisions; local Node timings were roughly 0.003 ms median and 37–42 ms at the worst fallback cases. These are geometry timings, not browser interaction metrics or a mobile performance claim.
- Keep table virtualization, bounded data fetching, existing caches and URL state. Measure browser INP/LCP/CLS and route bundles before adding graphical effects; set budgets against measured baselines.
- Prefer small CSS/SVG improvements and existing tokens over adding an animation or component framework. Consolidate spacing, paper/ink contrast and control sizes incrementally.
- Research notes and watchlists should remain private by default. Future telemetry must not include search terms, saved notes, investigation URLs or watchlist contents.

## Verification and remaining limits

Regression files: `web/tests/board-layout.test.mjs`, `web/tests/board-ux.smoke.test.mjs`, `web/tests/navigation-ux.smoke.test.mjs`, and the existing smoke suite. They exercise supported dense layouts, resize/view-switch behavior, desktop/phone evidence dismissal, citation Escape handling, text-selection drags, focus, section anchors and wheel chaining.

Use the verification results recorded in `STATUS.md` for this branch. Production-data validation requires a generated data tree; it cannot run against this checkout's absent `web/public/data/meta.json`. The implementation is not a production deployment until merged and deployed. Safari/iOS, a hardware trackpad and assistive-technology testing remain follow-ups; native scroll chaining can wait for the next wheel gesture depending on browser input latching.

No connector is required for these fixes. Figma is optional for reviewing a reusable design system or comparing future visual directions; it is not a prerequisite for implementation.
