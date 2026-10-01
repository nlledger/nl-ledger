# Astro readability pass

Page markup now lives in directly nested Astro components. Formatting helpers are imported where they are used, page builders pass plain data, and JavaScript entry points render imported component references. The 54 remaining `set:html` sinks are icons. Source text and formatted numbers use escaped expressions.

## Target structure and implementation plan

1. Commit portable static, Worker request and browser capture harnesses; prove frozen main against itself.
2. Put the shell in Layout with page, head, script and structured-data slots. Move shared markup from `lib/html.mjs` into named components; apply mobile table annotations after rendering.
3. Convert home, budgets, departments, bodies, members, pay, pattern families and informational pages, plus request-time search, records, suppliers, receipt and feedback. Keep data and metadata in the existing JavaScript builders. Split pattern families into named components. Remove unused wrappers and the OneToOne entry; preserve its used spending callout as SpendingCallout.
4. Enforce direct composition, helper imports, escaped content and the icon-only cap through `site/check-components.mjs` and `site/check.sh`; document the rules in CONTRIBUTING.
5. Run the affected rendering and consumer checks, cold-review the changes, and wait for GitHub checks. Leave the PR open.

## Verification

Baseline: `origin/main` at `f9b4702`, using the same frozen data snapshot and public Turnstile test key as the branch. No source downloads or production data updates.

- Main against itself: 409 HTML routes, 291 share PNGs and 68 Worker cases, zero differences.
- Main against the branch: 409 HTML routes, metadata and structured data match; 291 share PNGs are byte-identical; app.js, CSS, generic image, sitemap and robots are unchanged.
- Local Worker comparison: 68 cases check status, headers and content across page families, combined suppliers, hostile queries, invalid receipt income, HEAD/OPTIONS/PUT and refused feedback POSTs. No accepted notes are submitted. The harness requires localhost.
- Chrome capture: 188 views per build, at 390 and 1280 pixels in light and dark. Three tiny raster differences in the first run disappeared in a 12-view focused repeat. Search results were also checked in the normal Chrome profile.
- Production `npm run build --prefix site` and site guardrails pass. Targeted checks cover tables, imported source escaping, federal evidence, claims, MCP parity, search, request handling, feedback, receipt privacy, cards and guarded errors.
- Enforcement was checked with temporary counterexamples: helper props, raw publisher HTML, HTML inside JavaScript data and string-based component dispatch each failed; the restored code passed.
- Solo cold review removed unused rendering wrappers and imports, split the pattern families, and corrected composition differences caught by the frozen-build comparison. No remaining correctness findings.

Comparison commands and normalization rules: [Rendering comparisons](../site/scripts/compare/README.md). Local proof artifacts are outside the repository at `/private/tmp/nlledger-readability/`.

No production deployment, live feedback submission, pipeline fetch, D1 synchronization or merge. The full CI suite is left to GitHub, as requested by the brief.
