# Rendering comparisons

Build both checkouts from the same frozen `data/` snapshot and `NL_LEDGER_TURNSTILE_SITEKEY` (no pipeline fetch). From each repository root, `node site/build.mjs` compiles the Astro components and writes `site/dist/`.

```sh
node site/check-rendering.mjs BEFORE/site/dist AFTER/site/dist
node site/scripts/compare/requests.mjs http://localhost:8890 http://localhost:8896 BEFORE/site/dist AFTER/site/dist
```

Serve each checkout with `node site/dev.mjs PORT` (it builds first). The request harness requires localhost. Its 68 cases cover every page family, a combined supplier, hostile query text, invalid receipt income, HEAD/OPTIONS/PUT, and feedback refusals that stop before verification, storage or mail. It checks status, headers and parsed content. Only the response Date, byte-proven share-image names, the dynamic image build identifier and the local-host feedback error are normalized. It never sends feedback to the live site.

The static comparison checks all routes, structured data, share metadata and unchanged PNG bytes. DOM equality alone cannot prove safe source escaping; also run `node site/check-source-escaping.mjs` and `node site/check-requests.mjs` for hostile publisher text, attributes and script confinement.

The PR #19 Chrome capture harness covers the same route families at 390 and 1280 pixels in light and dark. Install Playwright outside the repo, then point the harness to that module:

```sh
npm install --prefix /tmp/nl-ledger-browser-proof playwright
PLAYWRIGHT_MODULE=/tmp/nl-ledger-browser-proof/node_modules/playwright/index.mjs node site/scripts/compare/screenshots.mjs /tmp/before http://localhost:8890
PLAYWRIGHT_MODULE=/tmp/nl-ledger-browser-proof/node_modules/playwright/index.mjs node site/scripts/compare/screenshots.mjs /tmp/after http://localhost:8896
```

It uses installed Chrome. Each output directory contains PNGs and a manifest. An optional fourth argument supplies a JSON array of routes for a focused repeat. Keep captures outside the repository. Compare decoded pixels rather than treating PNG compression bytes as proof of a visual change.

For the merge with the Astro edge fixes, also run `node site/check-astro-edge-rendering.mjs BEFORE/site/dist AFTER/site/dist`. It compares parsed serialization, exact protected text and whole control-group spacing. This permits template indentation and equivalent entity spelling without hiding missing link/button separators. The recorded run is in [Readability merge comparison](../../../docs/readability-rebase.md).
