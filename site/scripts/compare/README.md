# Rendering comparisons

Build both checkouts from the same frozen `data/` snapshot and `NL_LEDGER_TURNSTILE_SITEKEY` (no pipeline fetch). `node build.mjs` compiles the Astro components and writes `dist/`.

```sh
node site/check-rendering.mjs BEFORE/site/dist AFTER/site/dist
node site/scripts/compare/requests.mjs http://localhost:8890 http://localhost:8896 BEFORE/site/dist AFTER/site/dist
```

Serve each checkout with `node site/dev.mjs PORT` (it builds first). Requests use the local SQLite index and never send feedback to the live site. For screenshot proof install Playwright in a temporary directory and run the original PR #19 capture script with that package available:

```sh
node site/scripts/compare/screenshots.mjs /tmp/before http://localhost:8890
node site/scripts/compare/screenshots.mjs /tmp/after http://localhost:8896
```

The request cases include every page family, a combined supplier, hostile query text and invalid receipt income. The static comparison checks all routes plus unchanged share PNG bytes. DOM comparison alone cannot prove source escaping; retain raw attribute checks as well as the hostile-source regression check.
