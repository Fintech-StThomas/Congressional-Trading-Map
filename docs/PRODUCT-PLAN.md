<!-- Implementation plan and bounded agent work packets for Paper Trail. -->
# Paper Trail implementation plan

Planning date: November 15, 2026 (America/Chicago). Local checkout reviewed; production state is unverified.

## Outcome and scope

A reporter can find a documented relationship, verify the source, compare changes, save evidence, and export a
reproducible citation. The dark room frames the experience; records remain legible, accessible, and printable.
This plan sequences the integrated product brief. It does not reopen the project's privacy, range, matching,
colour, attribution, or free/no-ad decisions in STATUS.md.

First release: immutable dataset releases, release-pinned reads, a citation action, and contextual coverage.
Do not label a current mutable URL a permanent citation. Do not promise historical availability before archiving
begins. Data-source expansion, private accounts, and a board redesign are separate increments.

## Verified baseline

- Evidence drawers, source links, CSV/JSON downloads, board/table switching, assumptions, and source metadata exist.
- `pipeline/publish_r2.py` hashes files but overwrites `data/` and deletes stale files. Writing metadata last does
  not make multi-object publication atomic; clients can see mixed releases during upload or through stale caches.
- `web/src/lib/data/server.ts` keys caches with a metadata stamp but fetches mutable paths. Browser fetches and
  route-generated data also need release pinning; changing just the publisher is insufficient.
- Security headers, identifier validation, single-flight fetches, cache-policy invalidation, asset cache headers,
  and step-scoped publish configuration are present locally. These are implementation observations, not proof
  of deployed behaviour or a successful latest daily job.
- PR checks workflow and `scripts/ci/` are absent. Existing handoff/status security notes are partly stale.
- Holdings/positions backend work exists; do not reimplement it while planning the board's later timeline.
- No Senate holdings. Human filing spot-checks and organization-match sign-off remain unresolved.

## Delivery sequence

Sizes are relative work estimates, not calendar commitments: S = one bounded module or surface;
M = several connected modules; L = integration across pipeline, server, and browser. Split L work into PRs.

| ID | Work packet | Size | Depends on | Acceptance / completion gate |
|---|---|---|---|---|
| P0.1 | Reconcile local implementation, handoff, remote CI/deployment evidence | S | None | Label implemented, tested, deployed, and unknown separately; retain unresolved human reviews |
| P0.2 | Add PR checks and STATUS-update policy | M | P0.1 | Fixture build, web checks, pipeline unit tests run on a real PR; forks require no secrets; path policy has behavioural tests |
| P0.3 | Complete security, stale-data monitoring, and operational configuration | M | P0.1 | Local/remote CSP browser checks; successful daily refresh observed; alerts detect failure and stale build; platform settings verified |
| R1.1 | Offline deterministic release descriptor | S | Contract first | Stable identity for identical bytes/paths; changed content changes identity; invalid trees fail without corrupting output |
| R1.2 | Immutable archive publisher and release pointer | M | R1.1, P0.2 | Failure leaves active release intact; retry idempotent; old release accessible; archive outside legacy cleanup prefix |
| R1.3 | Pin server, browser, routes, and caches to one release | L | R1.2 | Requests spanning a publish never mix releases; unavailable snapshot fails explicitly; latest and permalink flows both work |
| R1.4 | Cite this + coverage panel + basic evidence packet | M | R1.3 | Saved citation resolves identical evidence after a newer publish; filters/assumptions recorded; missing never presented as zero |
| R2.1 | Disclosure-delay analysis | M | R1.4, date/source audit | Missing/invalid dates and amendments handled; wording distinguishes observed elapsed days from compliance |
| R2.2 | Filing and extraction-change comparison | M | R1.4, stable record identity | Separately identify filing amendment, source change, and parser correction; no inferred sale from missing report |
| R3.1 | Synchronized board/timeline/records | L | R2.2, existing position work reviewed | Preserve filters and selected evidence; distinct event/publication dates; keyboard/touch/print equivalents |
| R3.2 | Local saved boards, comparison, evidence export | M | R1.4 | Save/reload/export round trip; notes private by default; public links contain no notes |
| R3.3 | Documented connection finder | M | R3.1, temporal entity rules | Each hop has source, direction, dates; deterministic bounded search; no unsupported implied direct tie |
| R4.1 | RSS, citation-preserving embeds/share cards, research exports | M | R1.4 | Attribution and dates travel with result; accessible embed; versioned export reconstructs selected records |
| D1 | Senate holdings and direct-source ingestion pilot | L | Source-access feasibility and reviewed fixture set | Original filings reconciled to extracted fields, amendments, ownership, redaction, and ranges |
| D2 | Historical committees and reviewed lobbying | L | D1 can run later; attribution review required | Time-valid identity/jurisdiction joins; published coverage; human review before enabling matches |
| D3 | Bills/hearings/votes, contracts, earmarks, campaign spending | L | D2 and per-source contract | One source per increment, reconciled totals and temporal joins, evidence links and coverage |

Critical product path: R1.1 → R1.2 → R1.3 → R1.4. P0.2/P0.3 gate release; documentation and local tests can
advance while platform configuration is pending. Start D1 feasibility after the first citation milestone,
without making the existing-data workflow depend on a new scraper.

## First milestone: reproducible citations

### R1.1 — local foundation (this work)

Owner: GPT-6 Luna worker; lead owns contract and review. Files: `pipeline/release_manifest.py`, its tests,
data dictionary, pipeline README, and this status/plan. A stdlib-only command writes a descriptor outside the
validated data tree. It is opt-in, offline, and does not change live publication. Checksums identify bytes;
they neither authenticate authorship nor certify the accuracy of records. See the data dictionary for encoding.

### R1.2 — archive publication

Owner: GPT-6.1 Sol worker after lead approves schema/invariants. Proposed storage layout:

```
releases/<release_id>/<original relative data path>
releases/<release_id>/release.json
releases/current.json
```

Keep `releases/` outside the existing `data/` deletion scope. Upload and verify every described file before
publishing the release descriptor, then replace the single active pointer last. Existing release IDs are
immutable: compare/reuse identical objects; reject conflicting bytes. Serialize production publishers and
define rollback as moving the pointer to a previously verified release. Restrict immutable caching to archived
objects; keep the pointer short-lived/revalidated. Never include the pointer in the release hash.

Tests must interrupt publication at file, descriptor, and pointer stages; check retained prior releases,
idempotent retry, corruption rejection, and cleanup isolation. A private or local fake bucket is sufficient
for development; use a staged release before cutting production readers over. Signing is a later, separate
key-management feature. Do not turn checksums into an authenticity badge.

Archive only privacy-validated output. Define an exceptional withdrawal/tombstone process for discovered privacy
exposure before publishing permanent URLs; normal data corrections create a new version, never silently rewrite
old bytes. Retention/storage estimates and withdrawn-release behaviour must be documented at rollout.

### R1.3 — consistent readers

Lead designs release context; worker implements one reader layer at a time. Resolve latest once for a page/data
operation, then carry its validated release ID through server accessors, client requests, generated endpoints,
search indexes, and cache keys. Never accept a user-provided fetch host; validate IDs and relative paths against
the configured release base. Explicit old-release requests must not silently fall back to latest.

Proposed citation route `/r/<release_id>/m/<member_id>` and associated records/evidence links are separate from
latest routes. Pin dataset version, filter/assumption values, and calculation/method version. A dataset hash alone
does not preserve a computed result if application logic changes: persist the exported result and method metadata,
or retain a versioned renderer/calculation contract. Do not claim exact historical rendering until this is tested.

### R1.4 — user-visible citation workflow

Extend the existing evidence drawer and records view, avoiding duplicate formatting/URL helpers. Citation packet:
title, stable subject and record identifiers, source URLs, original filing dates, data release, retrieval date,
filters, assumptions, calculation version, exact displayed ranges, and coverage limitations. Explicitly label
summary-ledger links when they do not identify a transaction-level filing. Offer copy text and a downloadable
structured packet, with accessible success/error feedback and a plain print view.

Show coverage near the affected measure: no Senate holdings, unlinked organizations, unavailable years, missing
owner, unknown value. Use current metadata rather than hard-coded attribution percentages. Keep exact identifier,
reviewed match, statistical derivation, completeness, and freshness as separate facts.

End-to-end acceptance: publish test release A; select a member and filters; export a citation; publish B with a
changed record; reopen A and reconstruct the same values/evidence. Also test unavailable A, amended record,
House/Senate missing coverage, keyboard-only use, mobile layout, and printed output.

## Accuracy gates for later features

- Disclosure delay: verify current official House/Senate instructions before implementing deadline logic.
  The general rule uses 30 days from notification with a 45-day transaction cap. Missing notification dates,
  amendment dates, and source ambiguity prevent a simple counter from establishing compliance. Start with
  transaction-to-original-filing elapsed days and neutral labels; never infer a legal violation.
- History: distinguish event date, filing/publication date, and first observation by our system. A later archive
  cannot establish what the public could access earlier without contemporaneous evidence.
- Amounts: ranges and open-ended bands remain ranges. Holdings, purchases, contributions, and outside spending
  are separate quantities. Missing reports do not establish absence, disposal, or zero.
- Identity: dated ticker/company histories and reviewed mappings; no fuzzy entity merges. Reviewers must not
  sign off the outstanding human checks simply because an agent inspected them.
- Indicators: use countable, named overlap measures rather than a composite wrongdoing/conflict score.
- Path finder: limit hops and result count, explain ranking, show all intermediate records, preserve direction,
  and reject paths whose claimed temporal overlap is unsupported.
- New sources: primary extraction and community cross-checks both need verification; owning the parser alone
  does not make the output authoritative. Begin with a small reviewed set before bulk ingestion.

## Design and usability work packets

Use existing design tokens and shared controls. Add no heavy graphics library for atmosphere alone.
Selection lighting is decorative; text and controls retain contrast outside the selected area. Preserve red's
meaning, use labels/patterns for relationship types, and keep record text straight and readable. Old evidence
does not fade or fray in a way that implies lower reliability. Respect reduced motion and avoid hover-only actions.

Sequence: contextual coverage and citation controls first; synchronized views next; saved board interactions
next; guided case/search palette and lighting polish after navigation has been tested. A brighter reading mode,
table alternative, mobile evidence sheet, and clean export matter more than complex lighting effects.

Test with 3–5 political/local reporters using the same tasks: locate a member, explain a tie, find its filing,
identify a coverage gap, and export a citation. Record task completion, factual interpretation errors, time to
source, and places needing explanation. Initial gate: every participant reaches the source; any recurring
misinterpretation of ownership, coverage, or wrongdoing is fixed before broader release. This small sample is
directional usability evidence, not a statistical claim. Avoid logging research queries or private notes.

Figma is optional for shared mockups/design-system review; no connector is required for implementation from
the current repository. Use an actual browser for interaction/contrast/print verification when UI work begins.

## Model allocation and efficient execution

At most two active agents total: one lead and one worker. Reuse or replace the worker sequentially.
The user authorized cheaper-model delegation; model assignments describe roles, not guaranteed billing rates.

| Role | Model | Owns | Escalation |
|---|---|---|---|
| Architecture/review | Current high-tier lead | Dependency order, data semantics, contracts, privacy, final diff review | Resolve ambiguous reporting rules and cross-system changes here |
| Bounded worker | GPT-6 Luna | Repo inventories, small pure helpers, focused tests, mechanical docs | Stop at two unsuccessful fix attempts or unclear contract |
| Integration worker | GPT-6.1 Sol | Publisher/reader migration, UI wiring, behavioural integration tests | Escalate release consistency, ambiguous provenance, or expanding scope |

Each dispatch contains: objective, explicit file ownership, prerequisite contract, invariants, forbidden side
effects, acceptance checks, and expected report. Workers receive bounded context (`fork_turns=none`), do not spawn
agents, and do not change unrelated files. Lead and worker never edit the same file concurrently.

Workflow per packet:
1. Inspect its named files and check the prerequisite is complete.
2. Make a small diff; run targeted behavioural tests once, rerun only after relevant changes/failures.
3. Return diff summary, exact commands/results, unresolved assumptions, and any environment limitation.
4. Lead reviews semantics and failure paths independently; use a fresh focused review for high-risk migration.
5. Run repository-required checks at the integration boundary, then open a reviewable PR. Do not claim fixture
   tests validate actual filings, local tests validate deployment, or checksums validate data truth.

Do not run a full data download for documentation or an offline helper. Reuse caches/fixtures, avoid speculative
dependencies, and do not re-audit the whole repository per task. Record follow-ups here/STATUS instead of adding
unbounded scope. A failing baseline test is investigated and reported; it is not silently skipped.

## Verification, rollout, and rollback

Targeted helper test: `python -m pytest -q pipeline/tests/test_release_manifest.py`.
Before a merge proposal: `python -m pipeline.validate` (0 failures), `python -m pytest pipeline/tests`, and in
`web/`, `npm run build` and `npm test`, plus holdings validation when applicable. Real-data validation requires
the generated dataset/cache. Report unavailable prerequisites explicitly rather than presenting fixture coverage
as equivalent. PR workflow checks must actually run on GitHub before calling CI configured successfully.

Release rollouts require observing a successful daily job and testing live pages against that release. Rollback
uses the previous verified pointer plus compatible app code. Legacy data publication remains until new readers
are verified; remove it only in an explicit migration follow-up. Budget and measure archive bytes and storage
requests before broad retention. External settings (DNS, branch protection, environments) need direct verification.

Git history rewriting is a separate coordinated operation. Do not bundle it into these changes; verify the
handoff's timing prerequisites with the owner and collaborators at the time of execution.

## Deferred deliberately

Email subscriptions/accounts, real-time collaborative private boards, composite scores, investment-copying
features, prediction markets, and expansion to executive/judicial/state populations are outside the first release.
Revisit expansion after reliable citations, current congressional coverage, and observed reporter demand.

## Execution log

- Initial local audit delegated to GPT-6 Luna; lead independently inspected publisher and reader consistency.
- R1.1 implemented by the same worker under a contract-first scope, reviewed by the lead, and verified with
  18 passing focused tests. Review caught silent directory-enumeration failure; the worker fixed it and added
  failure-path coverage. Production publication remains unchanged.
- Verification used `/tmp/paper-trail-plan-venv/bin/python -m pytest -q pipeline/tests/test_release_manifest.py`;
  pytest was installed only in that disposable environment. `git diff --check` passed. Full pipeline/data/web
  integration checks were not run for this isolated opt-in helper; this is not a merge or deployment sign-off.
- R1.2 implemented and reviewed as an opt-in publisher. Its fake-S3 suite covers immutable reuse, interrupted
  uploads, conflicting objects, source mutation, concurrent pointer changes, ambiguous responses, verified
  rollback, invalid descriptors and missing credentials. The legacy daily publisher is unchanged.
- P0.2 implemented locally: a read-only pull-request workflow runs pipeline tests, a fixture web build, lint,
  type checking, Chromium tests and the STATUS policy. It must run successfully on an actual PR before the
  workflow itself is considered verified; branch protection remains an owner setting.
- 2026-11-16 continuation (branch `claude/gallant-allen-60we8b`), lead with cheaper-model workers:
  - R1.3 release-pinned readers and `/r/<release>/...` permanent pages (opt-in `RELEASE_BASE_URL`); verified against a fake local bucket (`npm run test:pinned`, 7 tests), not on Vercel or R2.
  - R1.2 operations: provider check, history index, withdrawal, staging/rollback workflow, opt-in daily archive step (`PT_PUBLISH_RELEASES`); fake-S3 tests only. Owner checklist: `docs/RELEASE-OPERATIONS.md`.
  - R1.4 citation packets and contextual coverage notes; R2.1 `delays.json` and `/delays`; R2.2 `/changes`; R3.1 synchronized views; R3.2 `/saved`; R3.3 `/connect`; R4.1 feeds, embeds, share images, `/export`.
  - D1–D3 feasibility survey (`docs/SOURCE-EXPANSION.md`) and an unpublished Congress.gov pilot.
  - Checks at the end: pipeline + CI-script tests 242 passed; web build clean; `npm test` 215 passed, 17 skipped (need real data); pinned 7 passed. `python -m pipeline.validate` and holdings validation were not run (no generated dataset in the session). Screens were checked by eye at desktop and 390px on the sample site only.
  - Three workers ran in parallel in two waves, above the two-agent cap in STATUS; later waves kept to two.
- Remaining before production activation: provider check on R2, one observed archived daily run, Vercel Preview with `RELEASE_BASE_URL`, then Production; reporter usability sessions; human review of the delay audit's open questions and the Congress.gov sample.
