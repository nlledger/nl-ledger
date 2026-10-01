#!/usr/bin/env bash
# The weekly job, run inside the container (Dockerfile) by the home server's scheduler.
# Order matters: nothing reaches the site until every check has passed, and the D1 budget
# is checked before deploying so the site and the search index never go out of step.
#
# Needs: CLOUDFLARE_API_TOKEN (permissions in NOTES.md, "Weekly job"), CLOUDFLARE_ACCOUNT_ID, NL_LEDGER_D1_ID and the NL_LEDGER_S3_*
# settings (see archive.py). Prints "== <step>" before each step, "FAILED at <step>: ..." on
# failure and one "SUMMARY: ..." line at the end; the host script sends those to Healthchecks.
set -euo pipefail
cd "$(dirname "$0")"
export NL_LEDGER_ARCHIVE_REQUIRED=1
SITE_URL=${NL_LEDGER_SITE_URL:-https://nlledger.ca}

current="start"
step() { current="$1"; printf '\n== %s  (%s)\n' "$1" "$(date -u +%H:%M:%S)"; }
trap 'echo "FAILED at ${current}: exit $? (see the log lines above)"' ERR

step "settings"
for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID NL_LEDGER_D1_ID NL_LEDGER_S3_ENDPOINT NL_LEDGER_S3_BUCKET NL_LEDGER_S3_KEY_ID NL_LEDGER_S3_SECRET; do
  [ -n "${!v:-}" ] || { echo "FAILED at settings: $v is not set in the job's .env"; exit 1; }
done
echo "commit ${GIT_SHA:-unknown}"

step "cloudflare token"
# Checked first so an expired or revoked token fails in seconds, not after the whole pipeline.
status=$(curl -fsS -m 20 --retry 3 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" | jq -r '.result.status // "unknown"') || status="rejected"
[ "$status" = "active" ] || { echo "FAILED at cloudflare token: Cloudflare says the token is $status; make a new one (NOTES.md, Weekly job)"; exit 1; }
echo "token active"

step "fetch"
rm -f ../data/cache/_fetch_failures.json
./run.sh fetch

step "archive"
uv run python archive.py

step "process"
./run.sh process

step "archive"   # stats.py may have fetched StatCan tables during processing
uv run python archive.py

step "guards"
uv run python guards.py check

step "d1 budget"
uv run python d1_sync.py --dry-run

step "meaning index check"
# Proves the token can run Workers AI and reach Vectorize before anything is deployed.
uv run python vectorize_sync.py --dry-run

step "site build"
# Build and run the guardrails before deploying; cf deploy runs its own build again.
cd ../site
node build.mjs
./check.sh

step "deploy"
npx cf deploy
local_hash=$(sha256sum dist/index.html | cut -d' ' -f1)
gathered=$(grep -o 'Data gathered [^<]*' dist/index.html | head -1 | sed 's/\.$//')

step "live check"
# Static assets update within seconds of a deploy; allow two minutes before calling it failed.
for i in $(seq 1 12); do
  live_hash=$(curl -fsS -m 20 -H 'Cache-Control: no-cache' "$SITE_URL/?v=$(date +%s)" | sha256sum | cut -d' ' -f1) || live_hash=""
  [ "$live_hash" = "$local_hash" ] && break
  sleep 10
done
[ "$live_hash" = "$local_hash" ] || { echo "FAILED at live check: $SITE_URL/ does not serve the page just built (deploy did not take)"; exit 1; }
echo "live home page matches the build: ${gathered:-no date found}"

step "d1 sync"
cd ../pipeline
uv run python d1_sync.py | tee /tmp/d1.log

step "meaning index"
# Embeds only the documents that changed since the last run (data/state/vectorize-*.json).
uv run python vectorize_sync.py | tee /tmp/vectorize.log

step "archive verify"
uv run python archive.py --verify 1

step "baseline"
uv run python guards.py commit | tee /tmp/baseline.log
items=$(grep -o '[0-9,]* items' /tmp/baseline.log | head -1)

trap - ERR
echo "SUMMARY: ${gathered:-data gathered unknown}; ${items}; $(grep -o '[0-9,]* rows written' /tmp/d1.log | tail -1 || echo 'D1 unchanged'); $(grep -o 'embedded [0-9,]*' /tmp/vectorize.log | tail -1 || echo 'embedded 0'); commit ${GIT_SHA:-unknown}"
