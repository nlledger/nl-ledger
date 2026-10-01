# Astro readability implementation plan

Goal: contributors can follow page markup and its component tree without tracing HTML strings through JavaScript.

1. Commit portable static, Worker request and screenshot comparisons. Run the frozen main build against itself, including hostile input and a combined supplier.
2. Components import formatting, constants and calculations. Shared markup becomes directly imported Astro components. The renderer accepts component references only at JavaScript entry boundaries. Layout owns the common shell and the post-render mobile-table transform.
3. Convert all page families: static informational, budgets, departments, members, pay, patterns and home; request-time search, records, suppliers, receipt and feedback. Tables keep their markup in Astro; JavaScript prepares plain records, not HTML cells. Delete unused one-to-one code.
4. Enforce component imports, escaped expressions and the remaining icon/number HTML sinks in check.sh. Document conventions and rerunnable proof commands.
5. Run touched checks, cold-review the diff, open the PR and wait for GitHub checks. No merge, production deployment, data fetch or D1 sync.

Proof: compare every static HTML route, share metadata and image bytes; compare Worker status, headers and parsed content; separately retain raw attribute spellings so equivalent DOM does not hide escaping drift. Test hostile publisher text and query input. Use the same frozen data and site key for both builds.
