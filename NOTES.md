# NL Ledger: maintainer notes

How the live site is hosted, built, deployed and checked. The README covers what the project is and how to run it locally. The name "NL Ledger" is set in `site/lib/format.mjs` (`SITE`) and the Worker name in `site/cloudflare.config.ts`.

## Live

| What | Where |
|---|---|
| Site | https://nlledger.ca (`www.nlledger.ca` redirects to it) |
| MCP server | https://nlledger.ca/mcp |
| Worker | `nlledger` (workers.dev address turned off; the domain is the only address) |
| D1 database | `nl-ledger` (search index, 29,035 documents for 143,133 line items; notes from the feedback box) |
| Vectorize index | `nl-ledger-meaning` (one vector per search document, for search by meaning; see "Search") |

The Cloudflare account ID and D1 database ID are not in the repository. Deploys and the D1 sync read them from `CLOUDFLARE_ACCOUNT_ID` and `NL_LEDGER_D1_ID`, in the environment or in `site/.env` (ignored by git; see `site/.env.example`). Building and checking the site locally needs neither.

## Hosting

- One Worker with static assets (Cloudflare's current replacement for Pages). Astro packages the pages from `site/dist` as static assets in `site/.astro-build/client`. Only the paths in `runWorkerFirst` (`site/cloudflare.config.ts`) enter the Astro endpoint (`site/src/pages/[...path].ts`), which delegates to `site/worker.mjs` and the existing handlers in `site/routes/`. Other paths still use the asset binding without running the Worker.
- Deploys use the `cf` CLI (open beta) with an auth profile bound to the checkout (`cf auth activate <profile>`). A login can see more than one Cloudflare account, so `cloudflare.config.ts` names the account from `CLOUDFLARE_ACCOUNT_ID`, and `d1_sync.py` passes the same variable to every `cf d1` command.
- `cf` no longer deploys Pages projects ("Legacy Pages is not supported"), which is why the site moved off Pages.
- `www.nlledger.ca` is a proxied placeholder record (`AAAA 100::`) and a zone redirect rule (301 to `https://nlledger.ca`, path and query kept).
- The zone has Always Use HTTPS on, so `http://` requests get a 301 to `https://`.

## Layout

| Path | What |
|---|---|
| `pipeline/` | Python (uv). Fetch, parse, build, flags, reconcile, export, D1 sync |
| `data/cache/` | Downloaded source files and `manifest.json` (URL, sha256, fetch time). Not in git |
| `data/clean/` | One CSV per source after parsing. Not in git |
| `data/build/ledger.db` | Local SQLite: the source of truth for the site. Not in git |
| `site/` | Page data (`build.mjs`, `src/pages/*.mjs`), Astro markup (`src/components/`, `src/layouts/`), shared code (`lib/`), Worker (`worker.mjs`, `routes/`), config (`cloudflare.config.ts`, `wrangler.config.ts`) |
| `docs/reconciliation.md`, `docs/trace-sample.md` | Checks against the sources (the trace sample is drawn once and kept) |
| `docs/supplier-matching.md`, `docs/supplier-merges.csv`, `docs/supplier-near-matches.csv` | Supplier matching: counts and largest merges, every joined name with its evidence, close names kept apart. Written by `pipeline/suppliers.py`; reviewed decisions are in `pipeline/supplier_rules.csv` |
| `docs/review-notes.md` | Second-review findings and what was done about them |

## Switching a source on or off

Paradise (`paradise`) and St. John's (`stjohns`) are switched off. Their fetch and parse code (`fetch_municipal.py`, `parse_municipal.py`) is kept.

- Off: the names are in `DISABLED` in `pipeline/common.py` and in `SOURCES_OFF` in `site/lib/search.mjs`. The pipeline then skips their fetch, parse, build, flags and reconcile steps, and `guards.py` ignores them.
- To switch one back on: remove its name from both lists, run `./run.sh` (it fetches and parses them again), then `node build.mjs` in `site/`. The Sources page, search filter, AI server source list and the small-purchases page (Paradise) return by themselves.
- Also restore their two entries in `DATASET_LABEL` (`site/lib/format.mjs`: "Town of Paradise payment", "City of St. John's payment (machine-read)").
- Wording that was reworded when they went off comes back with `git log --grep "Take Paradise and St. John's off"`: the home page, footer, README, AI server text, the "How patterns work" wording and the licence sentence on the Sources page.
- The first weekly run after switching on needs `NL_LEDGER_ACCEPT_CHANGES=1`, since the record count rises and the new sources appear.
- On switching on, the D1 sync adds their search documents.

## Adding a fiscal year's budget documents

The budget and accounts documents are fetched from addresses listed by hand in `pipeline/fetch_provincial.py` (the province gives each file its own name): `CRF_REPORTS`, `ESTIMATES`, `BUDGET_STATEMENTS`, `PUBLIC_ACCOUNTS`.

- A new budget (spring): add the year's Estimates and Statements and Schedules. The year appears on `/budget/` as a budget with no results yet, and as the estimates page under Priorities.
- A year's results (the Report in late summer, the Public Accounts in the fall): add each address when it is published. Once both are in, that year becomes the one on the home page and `/budget/`; the year before moves to `/budget/<year>/`.
- Run `./run.sh`, read the "Budget against actual" section of `docs/reconciliation.md`, and open the home page figures against the documents. A check that fails is either a new layout (fix the parser) or the documents disagreeing (it goes on the report card by itself).
- The first weekly run afterwards needs no override: the guards count line items and cached files, and both only grow.

## Run the pipeline

```sh
cd pipeline
./run.sh                      # fetch (cached), parse, build, flags, reconcile, export
uv run python d1_sync.py --dry-run   # what would change in D1
uv run python d1_sync.py             # push only changed search documents
uv run python vectorize_sync.py --cf-login   # embed only changed documents into the meaning index
```

- Downloads are cached; delete a file under `data/cache/` to fetch it again. The federal bulk files and the grants query are replaced in place by their publishers, so they are fetched again once 6 days old; published reports are fetched once.
- `./run.sh fetch` and `./run.sh process` run the two halves separately.
- `d1_sync.py` compares document hashes and writes only what changed. An unchanged re-run writes nothing. It refuses above 90,000 writes (D1 free plan: 100,000 rows written a day). It runs each query through `cf d1 query`, so it needs the `cf` login and no token of its own. It prints the rows D1 reports written.
- Full pipeline time: about 6 minutes, most of it the MHA PDFs (read word by word with pdfplumber).

## Weekly job

Every Monday 09:00 UTC the maintainer's home server runs the whole pipeline in a container (`Dockerfile`, entrypoint `pipeline/weekly.sh`). A GitHub Action was set aside because government sites may block cloud addresses.

| Step | What stops the run |
|---|---|
| Cloudflare token check | token expired or revoked (`/tokens/verify`) |
| Fetch | a listing page fails after three tries |
| Archive (`archive.py`) | the archive is unreachable, or a cached file no longer matches its manifest hash |
| Process | any parse, build, flags, reconcile or export error |
| Guards (`guards.py check`) | a new download failure, nothing fetched in 8 days, a dataset down over 2% or fewer cached files than the last good run |
| D1 budget (`d1_sync.py --dry-run`) | the sync would pass 90,000 writes; checked before deploying so the site and the search index stay in step |
| Deploy (`cf deploy`) | build or `check.sh` fails, or the upload fails |
| Live check | `https://nlledger.ca/` does not serve the page just built within two minutes |
| D1 sync | a D1 error, or remote and local counts differ |
| Meaning index (`vectorize_sync.py`) | a Workers AI or Vectorize error; its `--dry-run` also runs before deploying, so a token without those permissions stops the run before anything changes |
| Archive verify | one random archived file, fetched back, does not match its hash |
| Baseline (`guards.py commit`) | this run becomes the one the next run is compared with |

- The job needs `CLOUDFLARE_API_TOKEN` (an account token: Workers edit, D1 edit, Workers AI read, Vectorize edit, account settings read; zone read and Workers routes edit on `nlledger.ca`), `CLOUDFLARE_ACCOUNT_ID`, `NL_LEDGER_D1_ID` and the `NL_LEDGER_S3_*` settings in `archive.py`.
- A failure that has been checked and is real (a report withdrawn, a link the publisher broke for good, a better de-duplication) is accepted for one run with `NL_LEDGER_ACCEPT_CHANGES=1`; that run becomes the new baseline.
- The last lines of a run are `SUMMARY: Data gathered <date>; <items> items; <rows> rows written` or `FAILED at <step>: ...`.
- Run the same container locally: `docker build -t nl-ledger-pipeline . && docker run --rm --env-file site/.env -v "$PWD/data:/app/data" nl-ledger-pipeline` (it deploys).

## Source archive

`archive.py` keeps every version of every downloaded file in S3-compatible storage (Garage on the home server, bucket `nl-ledger-sources`), so any figure can be traced to the exact file it came from after the publisher changes or removes it.

- Key: `<cache path>/<fetch date>_<sha256 first 16>`, for example `ppa/Contract-Awards-June-2025.pdf/2026-09-29_3fa1c2d4e5b6a7c8`. CSV, JSON and HTML are gzipped (`.gz`, `Content-Encoding: gzip`); PDFs, spreadsheets and zips are stored as they are.
- Metadata on each object: `source-url` (the government's address), `sha256`, `fetched-at`. The site's receipt links still point at the government's own address.
- A file is uploaded only when its hash is new for that path. A copy of `manifest.json` is kept per run under `_manifests/`.
- Without the `NL_LEDGER_S3_*` settings (a local run) the archive step is skipped with a message.
- `uv run python archive.py --verify 3` fetches three random files back and checks their hashes.

## Build and deploy the site

```sh
cd site
npm ci                         # locked Astro, Cloudflare and rendering tools
cf deploy                      # runs Astro, data build and ./check.sh, then uploads
cf deploy --dry-run            # build and checks only
```

- `build.mjs` minifies CSS whitespace and comments in `site/dist`, keeps `site/static/site.css` readable, and versions CSS/JS from the emitted bytes.
- Static assets and Worker HTML use the same security policy (`site/lib/headers.mjs`): nosniff, referrer and permissions policies, six months of HSTS, and CSP restrictions on framing, objects and the base URL. The CSP leaves the inline theme script, chart styles and Turnstile usable. `node site/check-headers.mjs` checks HTML errors, private responses and cache hits; the built-page checks verify static parity and asset versions.
- `node build.mjs` compiles the Astro markup and writes `site/dist`; it also renders the share PNGs. `check.sh` is the guardrail: backer name, author meta, accusation words.
- `cf deploy` invokes `astro build`. The integration in `site/scripts/astro-build.mjs` runs the data build and guardrails, then packages the adapter output with Wrangler (`site/wrangler.config.ts`). Output stays under `site/.astro-build/` and `site/.cloudflare/` (not in git). `site/scripts/adapter-config.mjs` derives the adapter binding configuration from `cloudflare.config.ts`; it never copies secret values.
- Mobile tables: `node site/check-tables-unit.mjs` checks shared/custom rendering. With a preview running, `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node site/check-tables.mjs after http://localhost:8791 /path/to/evidence` checks and captures 24 page types at 320, 390, 430 and 1280 px, light and dark. Phone rows retain all columns and source links; tablet and desktop tables keep their layout.
- Local preview: `./dev.sh` from the repository root (no Cloudflare account). It serves `site/dist` and runs the Worker's route code against a local SQLite copy of the search index (`data/build/local-search.db`). With no `data/build/ledger.db` it loads the sample in `sample/`. After a full pipeline run, `cd pipeline && uv run python make_sample.py` refreshes the sample (seeded, same rows each time unless the data changes); commit `sample/`.

## How the free plan limits shaped it

| Limit | Design answer |
|---|---|
| D1: 100,000 rows written a day | 143,133 line items packed into 29,035 search documents (one per award or contract; grouped per MHA category-year and pay-list job title). Diff-based sync |
| D1: 5 million rows read a day | Every filter is an indexed full-text token, no table scans. Search, supplier and record pages cached at the edge for an hour |
| Workers: 10 ms CPU | Pages are rendered from small documents; supplier pages read one of 512 JSON shards |
| Workers static assets: 20,000 files a version | 922 files: 410 static pages plus 512 shards; supplier, search, record and receipt pages are rendered on request |
| Workers: 100,000 requests a day | Only search, supplier, record, receipt and `/mcp` requests count. Static asset requests are free and unlimited |

## What is verified

- Totals against the sources' own printed totals (details in `docs/reconciliation.md`):
  - 224 minister reports: every report's lines add to its printed total.
  - 58,521 MHA lines: every category adds to its printed Period Activity; detail total equals the summary reports' total exactly.
  - Program spending: 174 of 175 department totals match the summary statements (the one department whose detail pages the 2024-25 report prints empty). Estimates: 248 of 248 department totals match the printed Program Funding Summaries.
  - Budget against actual, the deficit and net debt (`pipeline/parse_fiscal.py`, method on `/method/budget/`): 238 of 240 checks hold. The Report's cash statement recomputes; departments add to the statements' totals; the Original Estimates the Report reprints equal the budget's own Summary of Cash Requirements and, department by department, the Estimates as tabled; the Public Accounts' surplus or deficit and net debt recompute, and their Original Budget column equals the budget's statements. The two that fail are the province's documents disagreeing with each other (Executive Council 2020-21, Labrador Affairs 2024-25); both are on the report card.
  - The two parsers give identical output on the weekly job's image (poppler 25.03) and on macOS (poppler 26.09), checked 2026-09-30 on all 23 documents.
  - Federal contracts: $11.89B in address-selected published rows, CAD 2,547,127,660.51 after grouping by procurement and cleaned vendor name across departments and resolving the reviewed Health Canada name change on department/procurement/original start and value. Earlier rows remain provenance. This checks record counting, not geographic spending. Each federal record publishes `scope_review_state` separately from scope: incomplete reviews describe what NL Ledger has not established, without claiming source geography is absent. Reviewed named provincial-government transfers establish jurisdictional receipt only, never subsequent expenditure. The complete correction and every changed body/supplier/year/method/pattern amount are in `docs/federal-evidence-review.md` and `docs/federal-total-changes.csv`.
  - Federal grants: $11.68B as published, $8.43B as 29,207 agreements. Latest amendment where a department reports running totals (the data dictionary's rule); amendments summed for the four that report changes (Indigenous Services, Crown-Indigenous Relations, Canadian Heritage, Public Health Agency), each named with its evidence in `CHANGE_REPORTING` in `pipeline/parse_federal.py`. Public Accounts payments rule out reading Indigenous Services and Crown-Indigenous Relations as totals (the reviewer's $6.0B). Reading Heritage and the Public Health Agency as totals would give $8.37B. Corrections from $8.67B and $8.51B are on `/corrections/`.
- Supplier pages add up to the records: `site/src/shards.mjs` stops the build when the pages' records, totals or overlap differ from the database.
- A random sample of line items traced back to source files and pages (`docs/trace-sample.md`, results in `docs/review-notes.md`).
- A separate reviewer checked figures, wording, privacy and broken links (`docs/review-notes.md`).
- Guardrail script over the built site before each deploy.

## What is not verified

- Provincial income tax inputs: the 2025 brackets match CRA's rates page, and the basic personal amount ($11,067) matches CRA form NL428 (2025), both read in a browser because canada.ca refuses plain `curl` requests.
- CPP and EI credits on the receipt: form NL428 (2025) lines 27 and 29 take the base CPP and EI premium amounts at 8.7%; the enhanced CPP and CPP2 amounts are deductions from income. Rates and maximums are from CRA's CPP and EI pages (parameters in `pipeline/stats.py`); the method page shows a worked example at the median wage, checked by hand.
- PPA award rows have no printed totals to reconcile against; row counts per report are the check.
- Supplier matching (`pipeline/suppliers.py`, method on `/method/suppliers/`) joins names only on evidence: the same name once spelling and legal suffixes are set aside, a bilingual pair, a shared business number or postal code on federal records, the same federal award in two files, a department printed after its body's name, or a reviewed decision in `pipeline/supplier_rules.csv`. Provincial records carry no business number, so a misspelling there stays a separate supplier until a reviewed decision joins it (`docs/supplier-near-matches.csv` lists the candidates). Conflicting published business numbers or charity accounts now separate records before name normalization, and block every later join; unidentified records under an ambiguous name stay separate unless a unique postal code settles the identity. The source-backed split audit is in `docs/supplier-identity-audit.md`.
- Year-over-year department comparisons do not follow renamed departments.

## Search

`/search` and the AI server's `search_records` and `search` tools share `find()` in `site/lib/search.mjs`.

| Step | What it does |
|---|---|
| Exact | D1 full-text search: every word must appear, words match by their start. Listed first, largest first, exactly as before |
| Spelling | When nothing matches, each word no record contains is replaced by the closest word records do contain (`lib/spell.mjs`, one or two letters off). The page says so: "No record contains Memorail hospital. Showing records for memorial hospital." |
| Meaning | Page 1 only. Up to 20 records about the same thing that the exact search did not return, closest first, under "Close in meaning" (`lib/meaning.mjs`) |
| Suggestions | Under 5 exact records: shorter searches that do match ("who fixes the roads in Gander" → "roads gander") |

- Filters (source, year, pattern) apply to both lists. A supplier, public body, person or record filter switches meaning off.
- The word list is `/data/words.json`, written by `build.mjs` from `data/build/d1/docs.jsonl` (22,745 words, 88 KB compressed).

### How meaning works

- One vector per D1 search document: a short text (source, public body, title, descriptions, programs, methods, supplier, place) embedded with Workers AI `@cf/baai/bge-m3` (1,024 dimensions, handles French names), in the Vectorize index `nl-ledger-meaning` (cosine; metadata indexes `ds`, `y0`, `y1` for the source and year filters).
- Query: the search text is embedded, Vectorize returns the 50 closest documents, those scoring 0.42 or more are read from D1 by row id (the same `sha1(doc_id)` number `export.py` assigns, written into the SQL as digits because it passes JavaScript's safe integer range).
- The cutoff (0.42) comes from the query set: unrelated searches ("Zorblatt Industries", "space shuttle launch") score below it.

### Cost and safety

| Guard | What |
|---|---|
| Edge cache | Search pages are cached an hour (as before); a cached page calls nothing |
| Meaning cache | Each search text's closest documents are cached a day per Cloudflare location |
| Rate limit | `MEANING_LIMIT`: 30 uncached meaning lookups a minute per Cloudflare location; beyond it, search is exact only. The zone rule (40 requests per 10 seconds per address on `/search`, `/mcp` and the record pages) still applies |
| Fallback | No binding (local dev, CI), limit reached, a call over 2.5 seconds, or any error: exact search only, no error shown |

- Workers AI: bge-m3 costs $0.012 per million tokens; a search is about 10 tokens, and the free 10,000 neurons a day cover about 9 million tokens. A full re-embed of 29,035 documents is about 1.9 million tokens.
- Vectorize: (searches + stored vectors) × 1,024 dimensions at $0.01 per million, after 50 million free a month; storage is under $0.01 a month.
- Monthly, on top of Workers Paid: about $0 at 10,000 meaning lookups, $0.80 at 100,000, $10 at a million. Worst case under the rate limit: about $0.45 a day for each Cloudflare location a bot keeps busy.
- Measured from a Worker (99 searches): embedding 66 ms median (106 ms at the 95th percentile), Vectorize 84 ms (104 ms), D1 read by row id 14 ms (26 ms). The lookup runs alongside the exact search, so an uncached search takes about 150 ms longer.

### Rebuilding the index

- `pipeline/vectorize_sync.py` embeds only documents whose hash changed and deletes those gone. What the index holds is kept in `data/state/vectorize-nl-ledger-meaning.json`, written only after Cloudflare accepts each batch, so a failed run is repaired by the next. Without that file (a new machine, a lost volume) it embeds everything again: about 10 minutes, a few cents.
- The weekly job runs `vectorize_sync.py --dry-run` before deploying (the token can run Workers AI and reach Vectorize) and `vectorize_sync.py` after the D1 sync.
- By hand: `cd pipeline && uv run python vectorize_sync.py --cf-login` (the local `cf` login instead of a token). It creates the index and its metadata indexes when missing.
- A new model or a change to the embedded text: sync into a new index name (`--index`, `--model`, `--dims`), then point `MEANING` in `site/cloudflare.config.ts` and `MEANING.model` in `lib/meaning.mjs` at it and deploy.

### Checking it

- `node site/check-search.mjs` (CI): spelling, the meaning list and every fallback, on the sample with stand-ins for Workers AI and Vectorize.
- `node site/eval-search.mjs` (after a pipeline run, with the `cf` login): 30 searches a reporter, a councillor or a retiree might type, plus 3 that should find nothing (`site/search-queries.mjs`), scored on the first 10 records shown.
- Local preview with meaning: `NL_LEDGER_MEANING=1 ./dev.sh` (through the Cloudflare API with the `cf` login).

| Query set, first 10 records shown | Before (exact only) | After |
|---|---|---|
| Searches that find something relevant | 14 of 30 | 28 of 30 |
| Share of records shown that are relevant | 0.92 (117 shown) | 0.86 (267 shown) |
| Records shown for the 3 nonsense searches | 0 | 4 (Subway restaurant claims for "Toronto subway") |

- Exact-name searches (Nalcor, Deloitte, Microsoft, KPMG, Muskrat Falls) return the same records as before.
- Still missed: "cancer treatment" (nothing scores above the cutoff) and "consultants for the new hospital" (architects and consultants come back, none naming a hospital).
- Models compared on the same set (2026-09-29): bge-m3 had something relevant among its 10 closest documents for 27 of 30, bge-small-en-v1.5 for 25; bge-small scored nonsense searches as high as real ones, so no cutoff separated them. qwen3-embedding-0.6b embedded 4 times slower, refused batches of 100 ("input too big") and was dropped after 14,000 documents.

## Search engines

- `build.mjs` writes `sitemap.xml` (every static page, `/receipt/`, and the suppliers with 3 or more records or $250,000 or more on record; record and search pages are left out), `robots.txt` (with the `Sitemap:` line and `Content-Signal: search=yes, ai-input=yes`) and `data/links.json` (which `/body/`, `/pay/` and `/department/` pages exist, so pages rendered on request never link to a missing one). Thresholds are in `site/lib/indexing.mjs`.
- Indexing: `noindex,follow` on every search variant (any query, filter or page number), on record pages unless the record is a contract, grant or payment of $25,000 or more with a real description, and on supplier pages below the sitemap threshold. Pay and expense lines are never indexed on their own.
- Structured data (JSON-LD, `site/src/seo.mjs`): `BreadcrumbList` on every page with a breadcrumb line, `WebSite` with `SearchAction` and `Organization` on the home page, `Dataset` on `/data/`, `/priorities/`, `/members/`, `/federal/` and `/pay/*` (licence is the publisher's, not the code's), `Person` on MHA and minister pages, `Organization` on public body pages. No `Organization` on supplier pages (a payee can be an individual).
- `site/check.sh` runs `check-dist.mjs` on the built pages: internal links, JSON-LD parses, unique descriptions, sitemap and robots.
- Not in the repository: Google Search Console and Bing Webmaster verification (a TXT record on the domain), submitting the sitemap, IndexNow.

## Feedback box

Every page ends with a box ("Something missing, wrong or confusing?") and the top bar links to it. A note is stored in D1 and emailed. `/asked/` lists what people asked for and what was done.

| Part | Where |
|---|---|
| Form and box | `feedbackForm`, `feedbackBox` in `site/lib/html.mjs`; `layout()` adds the box to every page (`feedback: false` leaves it out) |
| Endpoint | `site/routes/feedback.js`: `POST /feedback`, the form on its own page at `/feedback/`, the thank-you at `/feedback/sent/` |
| In-page sending | the last block of `site/static/app.js`; without JavaScript the form posts as any form does |
| Tables | `feedback` (the notes) and `feedback_seen` (the per-address day count), defined in `site/feedback.sql`. The weekly sync reads and writes only `docs` and `meta` |
| "What people asked for" | content in `site/src/asked.mjs`; edit that file and deploy |
| Checks | `node site/check-feedback.mjs` (CI): what is stored, what is refused, nothing shown to anyone but the sender |

### Reading and clearing notes

```sh
cd site
./notes.sh             # the 20 newest notes (./notes.sh 100 for more)
./notes.sh done 12     # mark note 12 as dealt with
./notes.sh delete 12   # delete note 12
```

- The last line counts notes whose email was not sent.
- Each note shows its kind, the page it was sent from, the reply address if one was left, how the sender was checked (`turnstile` or `confirm`) and what the mail system answered (`sent <message id>` or `failed: ...`).
- A note whose mail failed is still in the table; the list is the record, the email is the notice.
- Replying to the email writes to the visitor when they left an address (it is the message's Reply-To). The reply goes out from whatever address the mailbox sends as.

### What stops junk

| Guard | What |
|---|---|
| Turnstile | Cloudflare Turnstile widget "NL Ledger feedback box" (managed, shown only when it needs a click, no clearance cookie). The script loads when someone starts a note (the first letter typed, a kind picked, or Send), never on page load. The server verifies the token before storing |
| Check page | No token (JavaScript off, Turnstile blocked or failed): the note is shown back on a page with a "Send this note" button. That page carries a token signed with the Worker's secret over the note and the time; it stores once, not within 2 seconds, not after 30 minutes, and not for a different note. A script can walk this page, so notes that come this way are capped at 60 in 24 hours, which leaves the rest of the day's room for Turnstile-checked notes |
| Trap field | A field people never see. A post that fills it is sent to the check page whatever Turnstile said, so a person whose browser filled it by mistake loses nothing |
| Rate limit | `FEEDBACK_LIMIT`: 4 posts a minute per network address. Cloudflare counts this per location and loosely; measured on 2026-09-30, a run of 14 quick posts had 5 refused by it. It slows a flood; the checks and the caps are what bound it |
| Per address, per day | 10 stored notes. Counted in `feedback_seen` under a keyed one-way code of the address (an IPv6 address counts as its /64); counts more than a day old are deleted whenever a note arrives |
| Per day, everyone | 300 stored notes in 24 hours; past that the form says to email instead |
| Size | 2,000 characters a note; a request over 40,000 bytes is refused unread |
| Origin | A post whose `Origin`, `Sec-Fetch-Site` or `Referer` names another site is refused |
| Nothing echoed | A note is shown only to its sender (the check page, or the form handed back with what to fix), in a response marked `no-store`. No page lists notes |

Both global caps are checked inside the same parameterized `INSERT … SELECT` that stores the note. D1 serializes that statement, so simultaneous submissions cannot reserve the same remaining slot. Only an inserted row schedules mail; a nonce replay succeeds without storing or sending again. `node site/check-feedback.mjs` covers both concurrent boundaries locally. `site/check-feedback-d1.mjs` is an opt-in check for a new, empty, disposable database named `nl-ledger-security-quota-check-*`; it refuses the configured live database.

### What Cloudflare logs

Workers Logs are on (`observability` in `site/cloudflare.config.ts`). Query strings are redacted (`redactQueryString: true`); `cf build` and the installed config converter preserve that setting. Receipt responses also send `Referrer-Policy: no-referrer`, and both the page shell and feedback handler remove receipt queries from saved/emailed page context. Shared `/receipt/?income=…` links still calculate normally. Verify the setting and a synthetic request in real logs after the authorized deployment; this PR does not deploy. Each request the Worker handles, a note included, is logged with its time, address, network address, location and browser headers; the form's fields are not (read from a logged `POST /feedback` on 2026-09-30). The Privacy section says so.

### Secrets and mail

- The Worker holds two secrets, named in `site/cloudflare.config.ts` so a deploy keeps them. A deploy stops with "required secrets have not been set" when either is missing. A deploy from a config that does not name them removes them.
- `TURNSTILE_SECRET`: the widget's secret key (Cloudflare dashboard, Turnstile, the widget, or `cf turnstile widgets get <site key>`). It also signs the check page's token and the per-address code. Without it the endpoint answers "Notes cannot be taken right now".
- `FEEDBACK_TO`: the mailbox notes are emailed to. The `send_email` binding delivers only to an address verified under Email Routing, Destination addresses; `info@nlledger.ca` is a routing rule, not a verified address, and is refused (`E_RECIPIENT_NOT_ALLOWED`).
- Set one: `cf workers secrets update FEEDBACK_TO --worker nlledger --body '{"name":"FEEDBACK_TO","type":"secret_text","text":"<address>"}'`.
- Mail is sent from `feedback@nlledger.ca` (any address on the domain works while Email Routing is on).
- The site key is public and is in `site/lib/html.mjs`. `./dev.sh` uses Cloudflare's published test keys, stores notes in `data/build/local-feedback.db` and sends no mail.
- `./notes.sh setup` creates the tables (once per database; safe to repeat).

### Preview copy

`NL_LEDGER_PREVIEW=1 cf deploy` (in `site/`) deploys the same code and bindings as a second Worker, `nlledger-preview`, on its workers.dev address, and leaves the live site alone. It reads and writes the live D1 database.

- Before the first deploy: set both secrets on `nlledger-preview` (the real ones, never Cloudflare's published test secret: it also signs the check page's token) and add its hostname to the Turnstile widget's domains.
- Afterwards: delete the Worker (`cf workers delete nlledger-preview`), take the hostname off the widget, and delete the test notes.

## D1 write budget

The NL Ledger account's first load on 2026-09-29 wrote 29,697 rows (D1's own count). The free limit is 100,000 a day per account and resets at midnight UTC. An unchanged re-run writes nothing.

## AI access (/data/ and the MCP server)

- Page: `site/src/pages/connect.mjs`; the client list, one-click links, starter questions and the home example answer are data in `site/src/connect.mjs`. Every client there is marked tested, seen or docs-only, with its doc link. Keep that true when adding one.
- Server: `site/lib/mcp.mjs`. `get_budget` reads `/data/budget.json` (built by `site/src/budgetdata.mjs`, the same figures the home page and `/budget/` show). `search_records` reads one window of 40 documents ordered by total, flattens to line items and pages them 25 at a time, so "largest" questions get the largest records. `get_members` reads `/data/members.json` (built by `site/src/mcpdata.mjs`). `search` and `fetch` follow OpenAI's deep-research shape. Four MCP prompts.
- Four summary tools share page calculations: `get_pay` reads employer/year figures from `src/paydata.mjs`, `get_body` reads the body-page queries in `src/bodydata.mjs`, `tax_receipt` calls `computeReceipt`, and `get_totals` uses `lib/totals.mjs` (also used for the home rankings). Totals cover all matching ledger records, not search pages. Sources and currencies stay separate, with overlap exclusions, missing/zero coverage and location/counting evidence. Department filters mean named record buyers; program accounts remain in `get_department` and `get_budget`.
- `/mcp` accepts one JSON-RPC message per HTTP request. Arrays (including empty and one-element batches) return HTTP 400 before dispatch. POST bodies over 65,536 bytes return HTTP 413; the handler counts streamed bytes before decoding/parsing and cancels the remaining body, regardless of `Content-Length`.
- The build writes totals by supplier/body shard and published year, plus precomputed broad rankings. Published supplier aliases resolve to retained IDs; ambiguous names stay ambiguous. MCP's parsed-asset cache is bounded by both file count and bytes. No additional D1 tables or migrations are needed.
- Run `node site/check-mcp.mjs` for portable page parity and counting checks (also in CI). With `./dev.sh 8793` running on the full ledger, `node site/check-mcp-live.mjs http://localhost:8793` reads the actual Worker and pages back against the ledger. The twelve-question Claude Code run is recorded in `docs/mcp-tools-proof.md`.
- Discovery: `/server.json` (MCP registry format, schema 2025-12-11, validates), `/mcp/server-card` and `/.well-known/ai-catalog.json` (draft SEP-2127, served by the Worker), `/llms.txt`. Nothing submitted to any registry. The registry name `ca.nlledger/nl-ledger` needs HTTP proof at `/.well-known/mcp-registry-auth` when submitting.
- Icons: `icons` on the `initialize` server info, in `server.json` and in the server card point at `/nl-ledger-icon-256.png` and `/app-icon.svg` (from `brand/svg/app-icon.svg`). ChatGPT only takes an icon when an app is created, so `/data/` offers the 256 px PNG as a download.
- Tested 2026-09-29, before the move to nlledger.ca: Claude Code (`claude mcp add --transport http nl-ledger <address>/mcp`, then `claude -p`) and Codex CLI (`codex mcp add nl-ledger --url ...`, then `codex exec`) both connected and answered with source links. Gemini CLI added the server but was not signed in, so it did not answer.
- Seen working in a browser, not documented: `https://claude.ai/customize/connectors?modal=add-custom-connector` opens the add dialog; `https://claude.ai/new?q=` and `https://chatgpt.com/?q=` open a new chat with the text typed in (not sent).
- The "Try it here" panel calls `/mcp` once per press, never on load (D1 read budget).

## Page share images

`site/lib/share-card.mjs` chooses the text and enforces the privacy rule. Person pages and every individual record keep `/og.png`. Organisation names on department, public-body, employer and supplier cards are an exact reviewed list, not a guess based on a legal suffix: a sole proprietor can have one. Unreviewed names and queries outside the reviewed spending vocabulary keep the generic image. Add an organisation only after checking that the pictured name carries no person's name; a new deploy changes the image version.

Static page builders pass `card` with the same value they use on the page. `build.mjs` renders 1200×630 PNGs under `/share/static/`, named from the data, renderer, font and template bytes, cached for a year. A render failure rebuilds that page's metadata with the generic image and generic alt text. `data/share-cards.json` lists the cards built.

Supplier and search cards render on first request under `/share/dynamic/<build-version>/`; the Worker edge-caches successful PNGs for a year. Old versions, unknown suppliers, unsafe queries and failed generation return the generic image with a one-minute lifetime. If the asset binding itself fails, the image request redirects to the ordinary `/og.png` asset path. URLs take a supplier key or search words, never a visitor-supplied amount or card title. Search cache keys use the shared NFC/whitespace canonical query, with a 300-character raw-input limit before normalization. Only eligible cache misses charge `SHARE_RENDER_LIMIT` (namespace 350): 20 render attempts per minute, per Cloudflare location, across all cards and visitors. A missing/exhausted binding returns the generic image; hits do not charge it. Cloudflare rate limiting is permissive/eventually consistent, not a billing quota. Production and preview set a 1,000 ms CPU ceiling; normal cards were checked locally, with edge enforcement still awaiting deployment proof. `x-share-card` reports `miss`, `hit` or `fallback`.

Satori 0.26.0 and resvg WASM 2.6.2 are pinned. Satori's standalone entry uses imported Yoga WASM rather than compiling at request time. Both WASM engines initialize once per isolate. The card font is a fixed weight-850, width-72 Archivo instance derived from the existing font, with its own glyph advances for word wrapping; unsupported characters or text that cannot fit use the generic image. To regenerate the font and metrics, run `brand/src/card_font.py` from the root with fonttools and brotli available. Its licence is the same SIL OFL 1.1 as the source font.

`node site/check-cards.mjs` checks privacy, cents, zero versus missing data, French, oversized text, metadata, supplier titles, cache hits, stale versions, HEAD and rendering failures. When the build and dependencies exist it also checks all built PNGs and renders boundary fixtures.

### Cards preview

`NL_LEDGER_CARDS_PREVIEW=1 NL_LEDGER_SHARE_ORIGIN=https://cards-preview.nlledger.ca cf deploy` in `site/` deploys only `nlledger-cards-preview`, at https://cards-preview.nlledger.ca and https://nlledger-cards-preview.nl-ledger.workers.dev. It reads the existing data and meaning-search bindings; feedback secrets are omitted so it cannot accept notes. The preview has a 1,000 ms CPU limit, substantially below the Workers Paid default. Static metadata uses the preview origin only when `NL_LEDGER_SHARE_ORIGIN` is supplied; production defaults to `https://nlledger.ca`.

To rerun the throwaway proof after `npm ci` in `site/`, link `site/card-proof/node_modules` to `../node_modules` locally, then run `cf deploy --profile nl-ledger` in `site/card-proof/`. The proof reads the account settings from `site/.env`.

The throwaway initial proof lives in `site/card-proof/` and deploys only `nlledger-cards-proof`. Satori 0.33.5 failed in its HarfBuzz font-engine initialization on Workers; 0.26.0 returned a real PNG with French accents. The complete Worker subsequently rendered the actual template within the preview's enforced CPU limit. Review evidence is in `~/src/nl-ledger-review/cards/`; see `docs/share-cards-proof.md` for the recorded run.

## Federal selection, evidence and currency

An address selects a federal record; it does not establish where work, benefits or spending occurred. `pipeline/federal_evidence.py` carries the selection, reported address, independent evidence, unknowns and conflicts through the database and full export. Reviewed project decisions are in `pipeline/federal_location_reviews.json`, guarded against evidence changes. `site/lib/federal.mjs` shares the same rule, native currencies, money basis and overlap policy between pages, metadata, supplier shards and MCP.

Only source-supported CAD values enter CAD summaries, including supplier-matching reports. Notice/payment sources remain excluded from supplier commitment headlines and appear separately by source, basis, period, location evidence and currency. A retained combined body sum discloses overlap directly. All records carry missing/zero coverage. Source-field arithmetic checks and amendment-chain reviews do not prove where money was spent.

Run `cd pipeline && uv run python check_federal.py` for the real-source portable regressions, `uv run python check_federal.py --ledger` for the rebuilt full ledger, and `node site/check-federal.mjs --built` for export/shard/HTML/share/MCP parity. CI runs the portable Python and JavaScript checks. Rebuilding requires no deploy or D1 sync.
