"""Federal sources for NL.

- Contracts over $10K, CanadaBuys award notices, Public Accounts vol III: bulk CSVs.
- Grants and contributions: paged from the open.canada.ca datastore with an exact
  filter on publisher-reported recipient_province = NL (not project geography).
  All source fields are cached unchanged; the parser exposes address conflicts.
"""
import json
import urllib.parse

from common import CACHE, cache_path, fetch, is_stale, load_manifest, save_manifest, sha256, _session

# The publishers replace these files in place, so a weekly run fetches them again.
MAX_AGE_DAYS = 6

BULK = {
    "federal/contracts.csv": "https://open.canada.ca/data/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b/resource/fac950c0-00d5-4ec1-a4d3-9cbebf98a305/download/contracts.csv",
    "federal/awardNoticeComplete.csv": "https://canadabuys.canada.ca/opendata/pub/awardNoticeComplete-avisAttributionComplet.csv",
}
for y in (2022, 2023, 2024, 2025):
    BULK[f"federal/pss-{y}.csv"] = f"https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/idsps-dipss/idsps-dipss-{y}.csv"
    BULK[f"federal/tp-{y}.csv"] = f"https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/pt-tp/pt-tp-{y}.csv"
for y in (2024, 2025):  # the multi-year transfer table starts with 2024
    BULK[f"federal/mtp-{y}.csv"] = f"https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/ppt-mtp/ppt-mtp-{y}.csv"

DATASTORE = "https://open.canada.ca/data/en/api/3/action/datastore_search"
GRANTS = "1d15a62f-5656-49ad-8c88-f40ce689d831"


def fetch_grants(m: dict) -> None:
    dest = cache_path(CACHE / "federal" / "grants_NL.jsonl")
    tmp = cache_path(dest.with_suffix(".part"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0 and not is_stale("federal/grants_NL.jsonl", m, MAX_AGE_DAYS):
        return
    off, n = 0, 0
    with open(tmp, "w") as out:
        while True:
            q = urllib.parse.urlencode({
                "resource_id": GRANTS,
                "filters": json.dumps({"recipient_province": "NL"}),
                "limit": 10000,
                "offset": off,
            })
            r = _session.get(f"{DATASTORE}?{q}", timeout=300)
            r.raise_for_status()
            recs = r.json()["result"]["records"]
            if not recs:
                break
            for r in recs:
                out.write(json.dumps(r) + "\n")
            off += len(recs)
            n += len(recs)
            print(f"  grants: {n}")
    cache_path(tmp).rename(cache_path(dest))
    from datetime import datetime, timezone
    m["federal/grants_NL.jsonl"] = {
        "url": f"https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013/resource/{GRANTS}",
        "api": f"{DATASTORE}?resource_id={GRANTS}&filters=" + json.dumps({"recipient_province": "NL"}),
        "sha256": sha256(dest),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def main() -> None:
    m = load_manifest()
    for rel, url in BULK.items():
        fetch(url, CACHE / rel, max_age_days=MAX_AGE_DAYS, manifest=m)
    save_manifest(m)
    fetch_grants(m)
    save_manifest(m)


if __name__ == "__main__":
    main()
