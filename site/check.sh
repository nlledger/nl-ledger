#!/usr/bin/env bash
# Pre-deploy guardrails: neutral project, facts not accusations.
set -uo pipefail
cd "$(dirname "$0")"
fail=0
node check-astro-edges.mjs || fail=1
# Public records name many people; the site never names the people who run it.
# The one allowed exception is the address of the code repository, which the site links to.
# More names can be added, unpublished, as NL_LEDGER_PRIVATE_NAMES (a regex) in site/.env.
[ -f .env ] && NL_LEDGER_PRIVATE_NAMES="${NL_LEDGER_PRIVATE_NAMES:-$(sed -n 's/^NL_LEDGER_PRIVATE_NAMES=//p' .env)}"
names="steve ?clarke|clarke, ?steve${NL_LEDGER_PRIVATE_NAMES:+|$NL_LEDGER_PRIVATE_NAMES}"
if grep -rIiE "$names" dist lib routes worker.mjs static src/components src/layouts 2>/dev/null | cut -c1-200; then echo "FAIL: maintainer name found above"; fail=1; fi
if grep -rIl "<meta name=\"author\"" dist >/dev/null 2>&1; then echo "FAIL: author meta tag"; fail=1; fi
if grep -rIoiE ".{0,30}\b(waste|wasteful|slush|corrupt|corruption)\b.{0,20}" dist --include=*.html | grep -viE "waste ?water|waste management|solid waste|waste collection|waste disposal|hazardous waste|waste oil|biomedical waste|waste removal|waste bins?|waste haul|waste audit|waste diversion|waste reduction" | head; then echo "CHECK: accusation words above (allowed only as quoted records or 'people read as waste')"; fi
# Raw HTML in components is capped: new markup uses Astro expressions, which escape by default.
# All remaining sinks render icons. New content uses escaped expressions.
SET_HTML_CAP=54
count=$(grep -r "set:html" src | wc -l | tr -d ' ')
if [ "$count" -gt "$SET_HTML_CAP" ]; then echo "FAIL: $count set:html uses in src (cap $SET_HTML_CAP)"; fail=1; fi
node check-components.mjs || fail=1
node check-dataset-ld.mjs || fail=1
# Links, structured data, descriptions and the sitemap, on the built pages (CI has no dist, so it skips this).
if [ -f dist/index.html ]; then node check-dist.mjs || fail=1; fi
echo "guardrails: $([ $fail = 0 ] && echo pass || echo FAIL)"
exit $fail
