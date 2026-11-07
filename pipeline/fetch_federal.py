"""Federal sources for NL.

- Contracts over $10K, CanadaBuys award notices, Public Accounts vol III: bulk CSVs.
- Grants and contributions: paged from the open.canada.ca datastore with an exact
  filter on publisher-reported recipient_province = NL (not project geography). The portal
  reloads that table daily, so the fetch waits out the reload and keeps only a copy taken
  from one version of the table (fetch_grants).
  All source fields are cached unchanged; the parser exposes address conflicts.
"""
import json
import time

import requests

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
PACKAGE = "https://open.canada.ca/data/en/api/3/action/package_show"
GRANTS_DATASET = "432527ab-7aac-45b5-81d6-7597107a7013"
GRANTS = "1d15a62f-5656-49ad-8c88-f40ce689d831"
GRANTS_FILTERS = json.dumps({"recipient_province": "NL"})
# The datastore returns at most 1,000 rows a request, whatever limit is asked for (it served
# 10,000 until late October 2026).
PAGE = 1000
# open.canada.ca drops and reloads the grants table about once a day, usually between 09:00
# and 13:30 UTC. While it does, datastore_search answers 404 (the answer for a table that does
# not exist) or 500, so those are waited out: about 20 minutes per request.
RETRY_WAITS = (30, 60, 120, 240, 300, 300)
# Each reload renumbers every row's _id, so a fetch that straddles one is thrown away and
# started again; after this many restarts the run fails.
RESTARTS = 3


class GrantsChanged(Exception):
    """The table changed during the fetch: the rows written are not one consistent copy."""


def _datastore(params: dict, sleep=time.sleep) -> dict:
    """One datastore_search call for the grants table, retried while the portal reloads it."""
    params = {"resource_id": GRANTS, "filters": GRANTS_FILTERS, **params}
    for wait in (*RETRY_WAITS, None):
        try:
            r = _session.get(DATASTORE, params=params, timeout=300)
            if r.status_code not in (404, 409, 429) and r.status_code < 500:
                r.raise_for_status()
                body = r.json()
                if body.get("success"):
                    return body["result"]
            problem = f"HTTP {r.status_code} {r.text[:200]}"
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError, ValueError) as e:
            problem = f"{type(e).__name__}: {e}"
        if wait is None:
            raise RuntimeError(f"grants datastore still failing after {len(RETRY_WAITS)} retries: {problem}\n{_grants_state()}")
        print(f"  grants: {problem[:120]}; trying again in {wait}s")
        sleep(wait)
    raise AssertionError("unreachable")


def _grants_state() -> str:
    """What package_show says about the grants resource, for a failure that outlasts the retries."""
    try:
        r = _session.get(PACKAGE, params={"id": GRANTS_DATASET}, timeout=60)
        r.raise_for_status()
        res = {x["id"]: x for x in r.json()["result"]["resources"]}
    except (requests.RequestException, ValueError, KeyError) as e:
        return f"package_show also failed ({e}): the portal looks down"
    if GRANTS not in res:
        active = [f"{x['id']} {x['name']!r}" for x in res.values() if x.get("datastore_active")]
        return f"package_show no longer lists resource {GRANTS}; datastore resources now: {active}. Update GRANTS in fetch_federal.py"
    x = res[GRANTS]
    return f"package_show lists the resource: datastore_active={x.get('datastore_active')}, last_modified={x.get('last_modified')}"


def _snapshot(sleep) -> tuple[int, int | None]:
    """The filtered row count and lowest _id: both change when the portal reloads the table."""
    res = _datastore({"limit": 1, "fields": "_id", "sort": "_id"}, sleep)
    if res.get("total_was_estimated"):
        raise RuntimeError("the grants datastore reports an estimated total; the fetch cannot check it got every row")
    return res["total"], res["records"][0]["_id"] if res["records"] else None


def _settled(sleep) -> tuple[int, int | None]:
    """Wait until two snapshots a minute apart agree: a reload has finished filling the table."""
    last = _snapshot(sleep)
    for _ in range(30):
        sleep(60)
        now = _snapshot(sleep)
        if now == last:
            return now
        last = now
    raise RuntimeError("the grants datastore kept changing for 30 minutes")


def _fetch_grants_once(out, start: tuple[int, int | None], sleep) -> int:
    """Page through the NL rows in _id order into out; raise GrantsChanged unless they are one copy."""
    total, first = start
    seen, last_id = 0, None
    while seen < total:
        recs = _datastore({"limit": PAGE, "offset": seen, "sort": "_id"}, sleep)["records"]
        if not recs:
            raise GrantsChanged(f"rows ran out at {seen:,} of {total:,}")
        for rec in recs:
            if (last_id is not None and rec["_id"] <= last_id) or rec["_id"] < first:
                raise GrantsChanged(f"_id {rec['_id']} out of order at row {seen:,}")
            last_id = rec["_id"]
            out.write(json.dumps(rec) + "\n")
        seen += len(recs)
        print(f"  grants: {seen:,}/{total:,}")
    end = _snapshot(sleep)
    if end != start:
        raise GrantsChanged(f"table changed during the fetch: {total:,} rows from _id {first} at the start, {end[0]:,} from _id {end[1]} at the end")
    return seen


def fetch_grants(m: dict, sleep=time.sleep) -> None:
    dest = cache_path(CACHE / "federal" / "grants_NL.jsonl")
    tmp = cache_path(dest.with_suffix(".part"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0 and not is_stale("federal/grants_NL.jsonl", m, MAX_AGE_DAYS):
        return
    start = _snapshot(sleep)
    for attempt in range(RESTARTS + 1):
        try:
            with open(tmp, "w") as out:
                n = _fetch_grants_once(out, start, sleep)
            break
        except GrantsChanged as e:
            if attempt == RESTARTS:
                raise RuntimeError(f"grants: the datastore changed during {RESTARTS + 1} fetches in a row; last: {e}") from None
            print(f"  grants: {e}; waiting for the reload to finish, then starting again")
            start = _settled(sleep)
    cache_path(tmp).rename(cache_path(dest))
    print(f"  grants: {n:,} rows, one consistent copy of the datastore")
    from datetime import datetime, timezone
    m["federal/grants_NL.jsonl"] = {
        "url": f"https://open.canada.ca/data/en/dataset/{GRANTS_DATASET}/resource/{GRANTS}",
        "api": f"{DATASTORE}?resource_id={GRANTS}&filters={GRANTS_FILTERS}",
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
