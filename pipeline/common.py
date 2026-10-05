"""Shared helpers: paths, cached downloads, manifest, text normalisation."""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import requests

ROOT = Path(__file__).resolve().parent.parent
# NL_LEDGER_DATA points the pipeline at another data folder: check_fixtures.py parses the
# small source files in tests/fixtures/ there, in CI, without touching data/.
DATA = Path(os.environ["NL_LEDGER_DATA"]).absolute() if os.environ.get("NL_LEDGER_DATA") else ROOT / "data"
CACHE = DATA / "cache"
CLEAN = DATA / "clean"
BUILD = DATA / "build"
MANIFEST = CACHE / "manifest.json"
# Sources switched off: the pipeline does not fetch, parse, count or publish them. The parsers
# stay in the repository; to switch one back on, remove it from this set (NOTES.md, "Switching a source on or off").
DISABLED = {"paradise", "stjohns"}
# Downloads that failed during this run (url, file, reason). The weekly job clears it before
# fetching and fails on any failure the last good run did not already have (guards.py).
FAILURES = CACHE / "_fetch_failures.json"

# Links the publishers still list to files that were missing on NL Ledger's first run (2026-09-29)
# and were never used. fetch() skips them without a request, so they stop appearing in every run's notes.
GONE = {
    "https://www.assembly.nl.ca/Members/Expenses/Reports/Apr2024-Mar2025/LanePaulElvisDet2024-25.pdf",
    "https://www.assembly.nl.ca/Members/Expenses/Reports/Apr2024-Mar2025/LanePaulElvisSum2024-25.pdf",
    "https://www.assembly.nl.ca/Members/Expenses/Reports/Apr2025-Mar2026/GambinWalshSherryDet2025-26.pdf",
    "https://www.assembly.nl.ca/Members/Expenses/Reports/Apr2025-Mar2026/GambinWalshSherrySum2025-26.pdf",
    "https://www.assembly.nl.ca/Members/Expenses/Reports/Apr2025-Mar2026/KingMichaelDet2025-26.pdf",
    "https://www.assembly.nl.ca/Members/Expenses/Reports/Apr2025-Mar2026/KingMichaelSum2025-26.pdf",
    "https://www.assembly.nl.ca/Members/Expenses/Reports/Apr2025-Mar2026/ParsonsAndrew2025-26.pdf",
    "https://www.assembly.nl.ca/Members/Expenses/Reports/Apr2025-Mar2026/ParsonsPam2025-26.pdf",
    "https://www.gov.nl.ca/exec/tbs/files/CUDGC-Compensation-Disclosure-2022-1.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/NL-Housing-Corporation-Compensation-Disclosure-2022.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/NL-Liquor-Corporation-Compensation-Disclosure-2022.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/NLC-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/NLESD-2022-Compensation-Disclosure-2022.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/NLH-and-Affiliates-Compensation-Disclosure-2022.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/NLHC-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/Newfoundland-and-Labrador-Health-Services-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/Newfoundland-and-Labrador-Hydro-and-Affiliates-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/Oil-and-Gas-Corporation-NL-Compensation-Disclosure-2022.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/Oil-and-Gas-Corporation-of-Newfoundland-and-Labrador-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/PACSW-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/PILRB-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/PPA-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/PSC-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/RNC-Compensation-Disclosure.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/The-Rooms-Compensation-Disclosure-2.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/WHSCRD-Compensation-Disclosure-1.xlsx",
    "https://www.gov.nl.ca/exec/tbs/files/Workplace-NL-Compensation-Disclosure.xlsx",
}

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)


def checked_cache_parts(rel: str) -> tuple[str, ...]:
    """Reject path syntax, including encoded traversal, before constructing a cache path."""
    parts = rel.split("/")
    for part in parts:
        decoded = part
        for _ in range(8):
            if (decoded in ("", ".", "..") or any(c in decoded for c in "/\\:")
                    or any(ord(c) < 32 or ord(c) == 127 for c in decoded)):
                raise ValueError(f"unsafe cache path: {rel!r}")
            expanded = unquote(decoded)
            if expanded == decoded:
                break
            decoded = expanded
        else:
            raise ValueError(f"excessively encoded cache path: {rel!r}")
    return tuple(parts)


def cache_path(path: Path, *, allow_root: bool = False) -> Path:
    """Confine a file to CACHE before mkdir, cache lookup, download or archive read.

    The configured data directory may be a trusted worktree link. CACHE itself and
    every component below it must be real paths, including dangling symlinks.
    """
    path = Path(path).absolute()
    root = CACHE.absolute()
    try:
        rel = path.relative_to(root)
    except ValueError:
        raise ValueError(f"path outside download cache: {path}") from None
    if not rel.parts:
        if not allow_root:
            raise ValueError("a cached file must be below the cache directory")
    else:
        checked_cache_parts(rel.as_posix())
    component = root
    for part in (None, *rel.parts):
        if part is not None:
            component /= part
        if component.is_symlink():
            raise ValueError(f"symlink in download cache path: {component}")
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        raise ValueError(f"resolved path outside download cache: {path}") from None
    return path


def cache_write_text(path: Path, text: str) -> None:
    """Sidecar files obey the same confinement rules as downloaded sources."""
    path = cache_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cache_path(path).write_text(text)


for d in (CACHE, CLEAN, BUILD):
    if d == CACHE:
        cache_path(d, allow_root=True)
    d.mkdir(parents=True, exist_ok=True)

_session = requests.Session()
_session.headers["User-Agent"] = UA


def load_manifest() -> dict:
    path = cache_path(MANIFEST)
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_manifest(m: dict) -> None:
    cache_write_text(MANIFEST, json.dumps(m, indent=1, sort_keys=True))


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def record_failure(url: str, dest: Path, reason: str) -> None:
    """Note a failed download for this run; guards.py decides whether it is new."""
    dest = cache_path(dest)
    path = cache_path(FAILURES)
    failures = json.loads(path.read_text()) if path.exists() else []
    failures.append({"url": url, "file": str(dest.relative_to(CACHE)), "reason": reason,
                     "cached_copy": dest.exists() and dest.stat().st_size > 0})
    cache_write_text(path, json.dumps(failures, indent=1))


def is_stale(rel: str, manifest: dict, max_age_days: float | None) -> bool:
    """True when a cached file was fetched more than max_age_days ago (None: never stale)."""
    if max_age_days is None:
        return False
    fetched = manifest.get(rel, {}).get("fetched_at")
    if not fetched:
        return True
    age = datetime.now(timezone.utc) - datetime.fromisoformat(fetched)
    return age.total_seconds() > max_age_days * 86400


def fetch(url: str, dest: Path, *, refresh: bool = False, max_age_days: float | None = None,
          manifest: dict | None = None) -> Path | None:
    """Download url to dest unless already cached. Records url, sha256, fetched_at.

    Files that the publisher replaces in place (the federal bulk files) pass max_age_days so a
    weekly run fetches them again; published reports never change and are fetched once."""
    if url in GONE:
        return None
    dest = cache_path(dest)
    tmp = cache_path(dest.with_suffix(dest.suffix + ".part"))
    cache_path(FAILURES)
    own = manifest is None
    if own:
        manifest = load_manifest()
    dest.parent.mkdir(parents=True, exist_ok=True)
    rel = str(dest.relative_to(CACHE))
    refresh = refresh or is_stale(rel, manifest, max_age_days)
    if dest.exists() and dest.stat().st_size > 0 and not refresh:
        if rel not in manifest:
            manifest[rel] = {"url": url, "sha256": sha256(dest), "fetched_at": _mtime(dest)}
            if own:
                save_manifest(manifest)
        return dest
    for attempt in range(3):
        try:
            r = _session.get(url, timeout=120, stream=True)
            if r.status_code == 404:
                record_failure(url, dest, "404 not found")
                return None
            r.raise_for_status()
            tmp = cache_path(tmp)
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
            with open(tmp, "rb") as f:
                head = f.read(512).lstrip(b"\xef\xbb\xbf").lstrip().lower()
            if dest.suffix.lower() not in (".html", ".htm") and (head.startswith(b"<!doctype") or head.startswith(b"<html")):
                tmp.unlink()
                print(f"  NOT FOUND (HTML page served for {url})")
                record_failure(url, dest, "HTML page served instead of the file")
                return None
            cache_path(tmp).rename(cache_path(dest))
            manifest[rel] = {
                "url": url,
                "sha256": sha256(dest),
                "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
            if own:
                save_manifest(manifest)
            return dest
        except requests.RequestException as e:
            if attempt == 2:
                print(f"  FAILED {url}: {e}")
                record_failure(url, dest, str(e)[:200])
                return None
            time.sleep(2 * (attempt + 1))
    return None


def get_text(url: str) -> str:
    """A listing page. Retries twice; a page that still fails stops the run (its links are unknown)."""
    for attempt in range(3):
        try:
            r = _session.get(url, timeout=60)
            r.raise_for_status()
            return r.text
        except requests.RequestException:
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
    raise AssertionError("unreachable")


def _mtime(p: Path) -> str:
    return datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")


def source_url(rel: str) -> str:
    """Original URL of a cached file (receipt link)."""
    return load_manifest().get(rel, {}).get("url", "")


def pdftotext(path: Path, layout: bool = True, page: int | None = None) -> str:
    args = ["pdftotext"]
    if layout:
        args.append("-layout")
    if page:
        args += ["-f", str(page), "-l", str(page)]
    args += [str(path), "-"]
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def pdf_pages(path: Path) -> list[str]:
    """Text per page (layout mode). Pages split on form feed."""
    txt = pdftotext(path)
    pages = txt.split("\f")
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    return pages


def norm_space(s: str | None) -> str:
    import html
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


_SUFFIX = re.compile(
    r"\b(incorporated|inc|ltd|limited|corp|corporation|co|company|llc|plc|ulc|"
    r"ltee|ltée|limitee|limitée|l\.?t\.?d|the)\b\.?",
    re.I,
)
# The province's name in its short forms. "NL" and "N.L." are the same words as
# "Newfoundland and Labrador"; "Nfld" is "Newfoundland". Numbered companies use all three.
# Legal suffixes broken where a PDF table wraps a cell ("LIMITE D", "L TD"), or cut off where
# the federal contracts file stops a vendor name at 35 characters ("... ENGINEERING LIMIT").
_WRAPPED_SUFFIX = re.compile(r"\s(l td|limit ed|limite d|limi ted|lim ited|inc orporated)$")
_CUT_SUFFIX = re.compile(r"\s(limite|limit|limi|lim|lt|incorp|incorpor|incorporat|corporat)$")
_AND_CO = re.compile(r"\s(and|&)\s+(co|company)\b\.?", re.I)
_PROVINCE = [(re.compile(r"\bn l\b|\bnl\b"), "newfoundland and labrador"), (re.compile(r"\bnfld\b"), "newfoundland")]
# Everything after "o/a", "c/o", "dba" or "(formerly ...)" names something other than the
# payee: an operating name, a mailing address or an old name. The record belongs to the name
# before it. Operating names are never used to join records, because franchise names (a hotel
# brand, a pharmacy chain) are shared by different owners.
_TAIL = re.compile(
    r"(\s*[,(-]?\s*\b(o/a|o\.a\.|operating as|c/o|dba|d/b/a|doing business as|t/a|trading as|carrying on business as)\b"
    r"|\s*[,(-]\s*(care of|formerly|previously|now known as)\b).*$",
    re.I,
)


FRENCH = {"de", "du", "des", "la", "le", "les", "et", "pour", "ville", "gouvernement", "premiere", "universite", "college",
          "societe", "ministere", "conseil", "federation", "reseau", "administration", "portuaire", "autorite"}


def looks_french(name: str) -> bool:
    """A French name has French words: "Association pour les nouveaux Canadiens"."""
    return bool(set(entity_key(name).split()) & FRENCH)


def _acronym_of(words: str, acronym: str) -> bool:
    """ "(NLDC)" after "Newfoundland and Labrador Dairy Co-operative": the bracket's letters
    come in order from the name, starting with its first word. "(PEI)" after "Minister of
    Finance" or "(CANADA)" after "Siemens" does not, and stays part of the name."""
    letters = re.sub(r"[^a-z]", "", acronym.lower())
    text = re.sub(r"[^a-z ]", "", words.lower())
    if not letters or not text or text[0] != letters[0]:
        return False
    it = iter(text.replace(" ", ""))
    return all(c in it for c in letters)


def name_forms(name: str | None, bilingual: bool = False) -> list[str]:
    """The names one printed supplier field gives, first the one to show.

    Federal grants (bilingual=True) print the recipient as "English name|French name" (often
    the same name twice), sometimes with "/" between them. Both halves name the same
    recipient on the same record. In any source, a name printed twice ("X l X", "Vish
    Limited Vish Limitée") is one name.
    """
    s = norm_space(name)
    if not s:
        return []
    halves = re.split(r"(?<=\w\w)\s*/\s*(?=\w\w)", s)  # never inside o/a, c/o, d/b/a
    if bilingual and "|" in s:
        parts = [p.strip() for p in s.split("|")]
    elif bilingual and len(halves) == 2 and all(len(p.split()) >= 3 for p in halves) and looks_french(halves[1]):
        parts = [p.strip() for p in halves]  # "Association for New Canadians/Association pour les nouveaux Canadiens"
    else:
        m = re.fullmatch(r"(.+?) (?:[lI/-]) (.+)", s)
        parts = [m.group(1), m.group(2)] if m and entity_key(m.group(1)) == entity_key(m.group(2)) else [s]
        w = s.split()
        if len(parts) == 1 and len(w) % 2 == 0 and len(w) >= 4 and entity_key(" ".join(w[:len(w) // 2])) == entity_key(" ".join(w[len(w) // 2:])):
            parts = [" ".join(w[:len(w) // 2])]  # "Vish Limited Vish Limitée"
    out = []
    for p in parts:
        if p and entity_key(p) and entity_key(p) not in {entity_key(o) for o in out}:
            out.append(p)
    return out or [s]


def entity_key(name: str | None) -> str:
    """Normalised supplier/recipient key for matching across sources.

    Lower-case, accents stripped, apostrophes dropped ("Bishop's" and "Bishop’s" are one
    name), other punctuation and legal suffixes removed, "NL" and "Nfld" written out, and
    anything after "o/a" or "c/o" dropped. Deliberately conservative: it never merges names
    that differ in words. pipeline/suppliers.py joins names on stronger evidence;
    site/lib/mcp.mjs entityKey must stay the same as this function.
    """
    s = norm_space(name)
    s = re.sub(r"\blimited partnership\b|\bl\.\s?p\.?(?=\W|$)|\blp\b", " LP ", s, flags=re.I)
    s = s.replace("\u2019", "'").replace("\u2018", "'").replace("`", "'")
    s = _TAIL.sub("", s) or s
    m = re.search(r"\s*\(([A-Z][A-Z&.\- ]{1,11})\)\s*$", s)
    if m and _acronym_of(s[:m.start()], m.group(1)):  # a trailing acronym of the name: "(NLDC)", "(SARVAC)"
        s = s[:m.start()]
    s = _AND_CO.sub(" ", s)
    s = re.sub(r"\bco-?op(erative)?\b", "cooperative", s, flags=re.I)  # "Co-operative" is one word, not "Co."
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("'", "").replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = _WRAPPED_SUFFIX.sub("", s)
    if len(name or "") >= 33:
        s = _CUT_SUFFIX.sub("", s)
    s = _SUFFIX.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for pat, full in _PROVINCE:
        s = pat.sub(full, s)
    return s


def key_hash(s: str, n: int = 10) -> str:
    return hashlib.sha1(s.encode()).hexdigest()[:n]


def money(s: str | float | int | None) -> float | None:
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    t = s.strip().replace("$", "").replace(",", "").replace(" ", "")
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    if t in ("", "-", "—"):
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v
