# Astro rendering proof (#370)

The migration keeps the existing calculations, source selection, Worker dispatcher, request policies and browser script. Markup now lives in `site/src/components/*.astro` and `site/src/layouts/Layout.astro`; the page modules assemble data rather than long HTML strings.

Live feedback submission and mail are **untested end to end**: the brief forbids sending feedback. Feedback GET pages and secret bindings were verified on the real preview; storage, confirmation, escaping, caps, mail handling and receipt privacy passed the existing portable checks.

## Same frozen data, same reader output

Baseline: `origin/main` at `6e84e2a15ce59086c74e634a0d6b8728dd11bf6c`. Both builds use the same SQLite backup, D1 document export, catalog and source manifest gathered on 2026-09-30. No pipeline or D1 sync was run.

- **409 of 409 HTML pages match** after normalizing whitespace and attribute order. JSON-LD values are compared exactly, including whitespace inside strings. No HTML routes were added or removed.
- **42 request/page-type HTML cases also match**, including search, supplier, item, receipt, feedback and the missing page; only the documented build-version/image-name mapping is applied.
- **291 of 291 generated share PNGs are byte-identical.** Their metadata also matches.
- `app.js`, emitted CSS, generic `og.png`, sitemap and robots are byte-identical. Astro ships no client framework or hydration runtime. The adapter's only additional client asset is the immutable font used by the server-side PNG renderer.
- **168 paired full-page Chrome screenshots:** 42 page types × 390/1280 px × light/dark. 164 pairs match every pixel. The four differences below are sparse raster edges; element positions and normalized text match exactly in fresh browser contexts.

| Page | Width/theme | Differing pixels | Maximum RGB-channel difference |
|---|---|---:|---:|
| Budget 2020–21 | 390/light | 428 of 4,151,550 | 18/255 |
| MHA detail | 1280/light | 159 of 10,090,240 | 17/255 |
| Ask your AI | 390/light | 3 of 2,676,570 | 7/255 |
| Public body detail | 1280/dark | 5 of 11,608,320 | 2/255 |

The only intentional URL difference is the generated share-image filename: the existing cache key includes dependency and template source bytes, which change during a rendering migration. The comparison remaps those names **only after proving the PNG bytes identical**. The Worker code version also changes so old edge-rendered HTML cannot survive the migration. Asset versions derived from CSS/app.js bytes remain unchanged.

Reproduce the build comparison with dependencies installed and both frozen builds available:

```sh
node site/check-rendering.mjs /path/to/before/site/dist /path/to/after/site/dist
```

Raw HTML, PNGs, paired screenshots, geometry comparisons, Lighthouse reports and deploy logs were kept outside the repository. The request cases are in `site/check-requests.mjs`.

## Real Cloudflare proof

Before converting pages, Astro 7.3.5 with the Cloudflare adapter 14.3.3 deployed to a temporary workers.dev-only preview Worker, workers.dev only, no custom domains. Version `05d2b865-58bf-454d-a417-7f153e4ba675` served both a static Astro page and a Worker-rendered page. The latter read **29,024 D1 documents** and reported the D1, AI, Vectorize, assets, mail and all three rate-limit bindings present.

The complete migration was then deployed with the actual one-step command, on the requested account:

```sh
cd site
NL_LEDGER_ASTRO_PREVIEW=1 cf deploy --worker <preview-name> --profile nl-ledger
```

Final verified preview version: **`3d0e97e2-eed2-4d3a-828c-c447cab292a0`**. Its build ran `astro build`, the frozen-data build, `check.sh`, adapter packaging and the upload in that order. Production was never deployed.

Read back from that deployment:

- Home and missing-page static assets: HTTP 200 and 404 respectively, with the existing security headers.
- Search, supplier and item HTML: HTTP 200, original metadata and one-hour caching.
- Receipt at zero and $30,000: HTTP 200, `private, no-store` and `Referrer-Policy: no-referrer`.
- Feedback form and sent page: HTTP 200, `private, no-store`. Real Chrome also verified the theme switch, phone menu and local receipt calculation; changing income to $55,000 made no income-bearing network request and left feedback context as `/receipt/`.
- MCP initialize and `get_budget` from another Origin: HTTP 200 with the existing CORS policy. Batches return 400 and a body over 65,536 bytes returns 413 through the real Astro endpoint.
- Server card and AI catalog: HTTP 200 with the original content types.
- Eligible `snow removal` share card: real PNG with `x-share-card: miss`, followed by the same bytes with `x-share-card: hit` and the immutable one-year cache policy. This caught and fixed the adapter's font-URL versus font-bytes difference before handoff.

Cloudflare version readback confirms all ten binding names/types, the 1,000 ms CPU limit and `nodejs_compat`; startup time is 24 ms. D1, Vectorize, Workers AI, rate-limit namespaces/budgets, send_email and secret names are retained. Receipt log-query redaction and the 1,000 ms CPU ceiling remain in deployment configuration. No live feedback was posted, no D1 records were written, and no mail was sent.

## Browser and portable checks

- `check.sh` / `check-dist`: 409 built pages pass; owner-name scanning includes Astro templates.
- `check-claims`, `check-mcp`, `check-feedback`, `check-search`, `check-cards`, `check-headers`, `check-federal --built`, `check-source-escaping`, `check-receipt-privacy`, `check-tables-unit`: pass.
- Source escaping includes 73 static/Worker cases and a new literal-entity attribute regression.
- Real Chrome reflow: 38 routes × three width/text states × two themes = **228 cases, zero failures**, including 320 px and 200% enlarged text.
- Real Chrome tables: **192 captures**, 24 page types × four widths × two themes; semantics, numbers, missing/zero values and source links pass.
- Astro formatting and changed-module syntax: pass. A fresh locked install compiles the same registry bytes from another directory; generated output contains no machine-specific paths.
- Final Impeccable detector: no findings. Preservation audit confirms existing tokens, focus/ARIA semantics, native forms, light/dark presentation and responsive behavior. Design polish was limited to verifying parity; no aesthetic changes were made.
- Cold review fixed native attribute entity decoding, compiler working-directory dependence, and retry after a failed font fetch. A second pass found no remaining correctness or security blocker.

## Lighthouse

Lighthouse 13.5.0, standard mobile performance profile, real Chrome. The controlled baseline uses the frozen build with Brotli delivery; the migrated pages are measured on the real preview. The explicit 404 asset is measured at HTTP 200 because Lighthouse rejects an intentional 404 navigation; the public missing URL was separately verified as HTTP 404.

**All 42 page types pass: 100 before, 99–100 on the real preview.** All runs have zero layout shift.

| Route | Before | Real preview |
|---|---:|---:|
| `/` | 100 | 100 |
| `/priorities/` | 100 | 100 |
| `/department/digital-government-and-service-newfoundland-and-labrador/` | 100 | 100 |
| `/department/estimates-2026-27/` | 100 | 100 |
| `/budget/` | 100 | 100 |
| `/budget/2020-21/` | 100 | 100 |
| `/search/?q=snow+clearing` | 100 | 100 |
| `/search/?q=snow+cleering` | 100 | 99 |
| `/search/?q=Zorblatt+Industries` | 100 | 100 |
| `/bodies/` | 100 | 100 |
| `/flags/` | 100 | 100 |
| `/flags/no-competition/` | 100 | 100 |
| `/flags/severance/` | 100 | 100 |
| `/members/` | 100 | 100 |
| `/mha/wakeham-tony/` | 100 | 100 |
| `/ministers/steve-crocker/` | 100 | 100 |
| `/pay/` | 100 | 100 |
| `/pay/nl-health-services/` | 100 | 100 |
| `/supplier/8fd018745b/` | 100 | 100 |
| `/item/8038fab331ae/` | 100 | 100 |
| `/receipt/?income=30000` | 100 | 100 |
| `/receipt/?income=0` | 100 | 100 |
| `/federal/` | 100 | 100 |
| `/scale/` | 100 | 100 |
| `/data/` | 100 | 100 |
| `/about/` | 100 | 100 |
| `/sources/` | 100 | 100 |
| `/method/` | 100 | 100 |
| `/method/receipt/` | 100 | 100 |
| `/method/federal/` | 100 | 100 |
| `/method/suppliers/` | 100 | 100 |
| `/method/budget/` | 100 | 100 |
| `/method/no-competition/` | 100 | 100 |
| `/corrections/` | 100 | 100 |
| `/help/` | 100 | 100 |
| `/asked/` | 100 | 100 |
| `/terms/` | 100 | 100 |
| `/consulting/` | 100 | 100 |
| `/feedback/` | 100 | 100 |
| `/feedback/sent/` | 100 | 100 |
| `/404.html` | 100 | 100 |
| `/body/nl-health-services/` | 100 | 100 |

An earlier diagnostic on the uncompressed development server scored 90–99 before and 92–99 after. That measures uncompressed local delivery rather than Cloudflare delivery; those raw results are retained alongside the final reports. No CSS, fonts, browser behavior or content was altered to improve a score.

## Build and deployment arrangement

The data build compiles `.astro` sources with the native Astro compiler, then uses Astro's container renderer. The adapter's catch-all endpoint delegates to the existing Worker. A new rendering container per call keeps request state isolated. Worker caches include both component source and compiled bytes.

`cf` detects Astro and directly invokes `astro build`, so the build integration runs the data build and guardrails before adapter compilation, then writes the Cloudflare Build Output Specification. `cloudflare.config.ts` remains the source of deployment bindings; the adapter JSON is derived, ignored, and contains no secret values. `cf deploy` from `site/` remains one command.

The preview Worker is deleted after verification and green PR checks. No production deploy or merge is part of this change.
