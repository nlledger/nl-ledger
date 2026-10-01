# Readability merge comparison — 2026-10-01

PR #21 merges `origin/main` at `38d521829c76a864d1b2406e8c7f347231db3427` into `readability` (previous head `efaf7b2a2f12ab9a982cb93d2d75fcf1ed17d85b`). This preserves #22's MCP checks, #23's federal fixtures, #26's byte-derived share-image names and #24's Astro edge fixes. History is merged, not rebased.

## Resolution

- Keep the compile-first `build.mjs` entry and move main's updated builder into `build-site.mjs`. PNG bytes determine share-image names, including truthful fallback metadata. Static headers come from `STATIC_HEADERS`.
- Keep every explicit separator in ConnectBody, HomeAi and Layout, including mapped navigation. Keep `compact: "jsx"`, the Worker entry guard, status-aware asset handling, packaged header policy and direct-Wrangler refusal.
- Update the edge check to use component references and imported helpers. TypeScript remains a used development dependency: `check-components.mjs` uses its parser to enforce readability and escaping rules.
- The old byte-only edge comparison expected HTML-string indentation and entity spelling. Compare parsed serialization instead, preserving exact script/style/pre/textarea text and comparing whole control-group text before trimming nodes. Removing a navigation separator and changing script text both failed deliberate counterexamples. The existing static check still independently enforces DOM, JSON-LD, metadata, unchanged image names and identical PNG bytes.

## Frozen comparison

Both builds use `/private/tmp/nlledger-readability-rebase/data`, a local copy of the existing data, and public Turnstile test key `1x00000000000000000000AA`. Main is archived at the pinned commit in `/private/tmp/nlledger-readability-rebase/main`. No pipeline fetch or remote data writes.

SHA-256 inputs:

| Input | SHA-256 |
| --- | --- |
| `build/ledger.db` | `f5b325db39a65ffd7c441040c8037b88b76d99e9322c4fd0af3f476cca19cd44` |
| `build/flag_catalog.json` | `200bec79cb1e98f7408d9de192ab42f4a8e8c3cc49647b42cf985466d6893428` |
| `build/d1/docs.jsonl` | `966eb9a231086b4dda268582bbe795e3af8aafcabffdfab7c12dfdac2ad3b1e4` |
| `cache/manifest.json` | `3527ed5e53d634f7932f8529e942a123f971ac67ed74701afcbb832b59e019f9` |

Commands from the readability root:

```sh
NL_LEDGER_TURNSTILE_SITEKEY=1x00000000000000000000AA node site/build.mjs
# Run the same command from the pinned main archive.
node site/check-rendering.mjs /private/tmp/nlledger-readability-rebase/main/site/dist site/dist
node site/check-astro-edge-rendering.mjs /private/tmp/nlledger-readability-rebase/main/site/dist site/dist
# Main preview: node site/dev.mjs 8890; branch preview: node site/dev.mjs 8896
node site/scripts/compare/requests.mjs http://localhost:8890 http://localhost:8896 /private/tmp/nlledger-readability-rebase/main/site/dist site/dist
node site/check-cards.mjs
node site/check-components.mjs
node site/check-source-escaping.mjs
node site/check-requests.mjs
./site/check.sh
NL_LEDGER_TURNSTILE_SITEKEY=1x00000000000000000000AA npm run build --prefix site
node site/check-astro-edges.mjs --built
```

Results:

- 409 HTML routes match in parsed structure, structured data and metadata. All 291 share PNGs and their names are unchanged. JavaScript, CSS, generic image, sitemap and robots are unchanged.
- Strict parsed serialization, protected text and whole control-group spacing match across all 409 pages. HTML serialization shrinks by 2,162 bytes (24,619,712 to 24,617,550), from indentation/entity spelling changes.
- 68 local Worker cases: zero differences in status, headers and parsed content, using the documented Date/dynamic build/local feedback-origin normalization. No accepted feedback was submitted.
- Cards: 646 checks pass. Readability: 110 templates, 54 icon-only raw HTML sinks. Source escaping: 82 checks. Worker request regressions: 14 cases. Site guardrails and all 409 built-page checks pass.
- Astro build, packaged header equality, asset rules, entry guards, encoding depths/methods, explicit separators and direct-Wrangler refusal pass.

Logs and counterexample evidence remain outside the repository at `/private/tmp/nlledger-readability-rebase/`. Full CI is left to GitHub. No production deployment, pipeline fetch, D1 sync, live feedback submission or PR merge.
