"""Push the search index to Cloudflare D1, writing only what changed.

D1's free plan allows 100,000 rows written a day. This compares the local documents
(data/build/d1/docs.jsonl, from export.py) with what the remote database holds
(rowid and content hash), replaces changed documents (delete and insert in one request, so a
search never misses them), inserts new ones and finally deletes those that disappeared. An
unchanged re-run writes nothing, and a re-run after a failure finishes the job.

Runs queries through the `cf` CLI, so no token is handled here. The account and database IDs
come from CLOUDFLARE_ACCOUNT_ID and NL_LEDGER_D1_ID, in the environment or in site/.env
(see site/.env.example). Usage: uv run python d1_sync.py [--dry-run] [--max-writes N]
(--dry-run also exits non-zero when the sync would be refused, so the weekly job stops before deploying.)
"""
import json
import re
import subprocess
import sys
import time
import os
import tempfile
from pathlib import Path

from common import BUILD


def setting(name: str) -> str:
    """A deploy setting from the environment, else from site/.env."""
    if os.environ.get(name):
        return os.environ[name]
    env_file = Path(__file__).parent.parent / "site" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == name:
                return value.strip()
    sys.exit(f"{name} is not set; add it to site/.env (see site/.env.example)")


ACCOUNT = setting("CLOUDFLARE_ACCOUNT_ID")
DATABASE = setting("NL_LEDGER_D1_ID")
COLS = ["rowid", "body", "tags", "doc_id", "dataset", "title", "buyer", "total", "n", "date_min", "date_max", "h", "items"]
ROWS_WRITTEN = 0
# 429 / [7429] "D1 DB is overloaded. Requests queued for too long.": the request was refused, not run.
TRANSIENT = re.compile(r"\b5\d\d\b|\b429\b|overloaded|timed? ?out|ECONNRESET|ETIMEDOUT|fetch failed", re.I)


def query(sql: str, params=None) -> dict:
    """One D1 query (or several statements joined by ;) through `cf d1 query`.

    Retries only failures that look transient, so a write that succeeded is never sent twice
    blindly (a repeated insert costs rows from the daily write budget). Waits 5 s, doubling to
    a minute, about seven minutes in all, for D1 to stop refusing requests."""
    global ROWS_WRITTEN
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump([{"sql": sql, **({"params": params} if params else {})}], fh)
    env = {**os.environ, "CLOUDFLARE_ACCOUNT_ID": ACCOUNT}
    try:
        for attempt in range(10):
            r = subprocess.run(["cf", "d1", "query", DATABASE, "--batch", f"@{fh.name}"],
                               capture_output=True, text=True, env=env, cwd=Path(__file__).parent)
            if r.returncode == 0 or attempt == 9 or not TRANSIENT.search(r.stderr + r.stdout):
                break
            wait = min(60, 5 * 2 ** attempt)
            print(f"  D1 refused the request ({TRANSIENT.search(r.stderr + r.stdout)[0]}); retrying in {wait} s", flush=True)
            time.sleep(wait)
    finally:
        os.unlink(fh.name)
    if r.returncode != 0:
        raise RuntimeError(f"D1 error: {(r.stderr or r.stdout).strip()[:400]}")
    result = json.loads(r.stdout)
    ROWS_WRITTEN += sum(x.get("meta", {}).get("rows_written", 0) for x in result)
    return {"result": result}


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    dry = "--dry-run" in sys.argv
    max_writes = 90_000
    if "--max-writes" in sys.argv:
        max_writes = int(sys.argv[sys.argv.index("--max-writes") + 1])
    schema = (BUILD / "d1" / "schema.sql").read_text()
    local = {}
    with open(BUILD / "d1" / "docs.jsonl") as fh:
        for line in fh:
            d = json.loads(line)
            local[d["rowid"]] = d
    if not dry:
        for stmt in [s.strip() for s in schema.split(";") if s.strip()]:
            query(stmt)
    # Compare by doc_id: row ids are 60-bit and come back rounded through the JSON API.
    remote = {}
    offset = 0
    while True:
        res = query("SELECT doc_id, h FROM docs LIMIT 20000 OFFSET ?", [offset])["result"][0]["results"]
        if not res:
            break
        for r in res:
            remote[r["doc_id"]] = r["h"]
        offset += len(res)
    by_doc = {d["doc_id"]: d for d in local.values()}
    stale = [doc for doc, h in remote.items() if doc not in by_doc or by_doc[doc]["h"] != h]
    gone = [doc for doc in remote if doc not in by_doc]
    new = [by_doc[doc]["rowid"] for doc, d in by_doc.items() if remote.get(doc) != d["h"]]
    writes = len(stale) + len(new)
    print(f"remote {len(remote):,} docs, local {len(local):,}; delete {len(stale):,}, insert {len(new):,} (about {writes:,} rows written)")
    if writes > max_writes:
        sys.exit(f"Refusing: {writes:,} writes is over --max-writes {max_writes:,} (D1 free plan: 100,000 a day).")
    if dry:
        return
    def send(rids, stmts):
        # Each request first deletes the old versions of the documents it inserts, so a changed
        # document is never missing between requests, and a retried request cannot collide.
        query(";\n".join([f"DELETE FROM docs WHERE rowid IN ({','.join(map(str, rids))})", *stmts]))

    batch, rids, size, done = [], [], 0, 0
    for rid in new:
        d = local[rid]
        stmt = f"INSERT INTO docs({','.join(COLS)}) VALUES ({','.join(q(d[c]) for c in COLS)})"
        if len(stmt) > 90_000:
            # D1 refuses a statement over 100 KB (SQLITE_TOOBIG); bound values do not count towards it.
            query(f"DELETE FROM docs WHERE rowid = {rid}")
            query(f"INSERT INTO docs({','.join(COLS)}) VALUES ({','.join('?' * len(COLS))})", [d[c] for c in COLS])
            done += 1
            continue
        if size + len(stmt) > 90_000 and batch:
            send(rids, batch)
            done += len(batch)
            print(f"  inserted {done:,}/{len(new):,}", flush=True)
            batch, rids, size = [], [], 0
        batch.append(stmt)
        rids.append(rid)
        size += len(stmt)
    if batch:
        send(rids, batch)
        done += len(batch)
    import hashlib
    for i in range(0, len(gone), 500):
        # the same rowid export.py assigns, as an exact integer literal
        ids = ",".join(str(int(hashlib.sha1(doc.encode()).hexdigest()[:15], 16)) for doc in gone[i:i + 500])
        query(f"DELETE FROM docs WHERE rowid IN ({ids})")
    query("INSERT OR REPLACE INTO meta(k, v) VALUES ('synced_at', ?)", [time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())])
    n = query("SELECT count(*) n FROM docs")["result"][0]["results"][0]["n"]
    print(f"done: inserted {done:,}, replaced {len(stale) - len(gone):,}, deleted {len(gone):,}; remote now holds {n:,} documents (local {len(local):,}); {ROWS_WRITTEN:,} rows written")
    if n != len(local):
        sys.exit("MISMATCH between remote and local document counts")


if __name__ == "__main__":
    main()
