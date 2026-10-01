// Migration regressions: portable source/render checks, plus optional packaged/live checks.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "parse5";
import { spawnSync } from "node:child_process";
import { renderComponent } from "./lib/render.mjs";
import { icon, layout } from "./lib/html.mjs";
import { connectPage } from "./src/pages/connect.mjs";
import { SECURITY_HEADERS, STATIC_HEADERS } from "./lib/headers.mjs";
const root = import.meta.dirname;
const read = (p) => readFileSync(`${root}/${p}`, "utf8");
const pkg = JSON.parse(read("package.json"));
assert.ok(
  !pkg.devDependencies.typescript && !pkg.dependencies.typescript,
  "unused direct TypeScript dependency",
);
const { protectEntry } = await import("./lib/entry-guard.mjs");
const calls = [];
const env = {
  ASSETS: {
    fetch: async (r) => {
      calls.push(new URL(r.url).pathname);
      return new Response("<h1>Not found</h1>", {
        status: 404,
        headers: { "content-type": "text/html" },
      });
    },
  },
};
const run = protectEntry(async (request) => {
  calls.push(new URL(request.url).pathname);
  return new Response("upstream", {
    status: request.method === "PUT" ? 405 : 301,
    headers: { location: "/search/", "Referrer-Policy": "no-referrer" },
  });
});
for (const method of ["GET", "HEAD", "POST", "PUT"]) {
  const r = await run(
    new Request("https://nlledger.ca/search//?q=x", { method }),
    env,
    {},
  );
  for (const [k, v] of Object.entries(SECURITY_HEADERS))
    assert.equal(r.headers.get(k), k === "Referrer-Policy" ? "no-referrer" : v);
}
for (const depth of [11, 12, 20, 100]) {
  for (const route of [
    "supplier",
    "item",
    "search",
    "receipt",
    "feedback",
    "mcp",
  ]) {
    for (const method of ["GET", "HEAD", "POST"]) {
      const before = calls.length;
      const r = await run(
        new Request(`https://nlledger.ca/${route}/%${"25".repeat(depth)}61/`, {
          method,
        }),
        env,
        {},
      );
      assert.equal(r.status, 404);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(
        calls[before],
        "/404.html",
        "invalid path must bypass routing",
      );
      assert.equal(calls.length, before + 1);
      assert.equal((await r.text()).length > 0, method !== "HEAD");
      for (const [k, v] of Object.entries(SECURITY_HEADERS))
        assert.equal(
          r.headers.get(k),
          k === "Referrer-Policy" && route === "receipt" ? "no-referrer" : v,
        );
    }
  }
}
for (const path of [
  "/supplier/%2561/",
  "/supplier/%25/",
  "/item/%ZZ/",
  "/receipt/?income=55000",
]) {
  const before = calls.length;
  await run(new Request(`https://nlledger.ca${path}`), env, {});
  assert.equal(
    calls[before],
    path.split("?")[0],
    "guard must not rewrite valid or malformed paths",
  );
}
for (const path of [
  "/receipt//?income=55000",
  "/receipt/unknown?income=55000",
]) {
  const r = await run(new Request(`https://nlledger.ca${path}`), env, {});
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("cache-control"), "no-store");
}
const oldError = console.error;
console.error = () => {};
const failed = await protectEntry(async () => {
  throw new Error("expected test failure");
})(new Request("https://nlledger.ca/search/"), env, {});
console.error = oldError;
assert.equal(failed.status, 500);
assert.equal(failed.headers.get("cache-control"), "no-store");

// Static asset hits bypass Astro, preserve bytes/cache, and misses become no-store.
for (const path of ["/_astro/font.hash.ttf", "/share/static/hash.png"]) {
  for (const status of [200, 304, 404]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await protectEntry(() => {
        throw new Error("must use assets");
      })(
        new Request(`https://nlledger.ca${path}`, { method }),
        {
          ASSETS: {
            fetch: async () =>
              new Response(status === 304 ? null : "asset", {
                status,
                headers: {
                  "cache-control": "public, max-age=31536000, immutable",
                },
              }),
          },
        },
        {},
      );
      assert.equal(response.status, status);
      assert.equal(
        response.headers.get("cache-control"),
        status === 404 ? "no-store" : "public, max-age=31536000, immutable",
      );
      assert.equal(
        await response.text(),
        method === "HEAD" || status === 304 ? "" : "asset",
      );
    }
  }
}
const config = read("cloudflare.config.ts");
for (const path of ["/_astro/*", "/share/static/*"])
  assert.ok(
    config.includes(JSON.stringify(path)),
    "hashed assets must run Worker first",
  );

// Test actual compiler output, including map-generated navigation and inline groups.
const markup = await layout({
  title: "Check",
  path: "/",
  description: "Check",
  body: "<p>Check</p>",
});
const connect = await connectPage({}, { itemCount: 1 });
const home = await renderComponent("components_HomeAi_astro", {
  num: String,
  R: { itemCount: 1 },
  icon,
  EXAMPLE: {
    q: "Question",
    a: "Answer",
    source: { href: "/sources/", label: "Source" },
    record: "/item/example/",
    on: "2026-01-01",
  },
  fmtDate: String,
});
const text = (n) =>
  n.nodeName === "#text" ? n.value : (n.childNodes || []).map(text).join("");
let navCount = 0;
function walk(n) {
  if (
    n.attrs?.some(
      (a) => a.name === "class" && ["nav", "phone-nav"].includes(a.value),
    )
  ) {
    navCount++;
    const t = text(n);
    const links = n.childNodes.filter((c) => c.tagName === "a");
    assert.ok(links.length >= 7, "navigation retains every primary label");
    for (const link of links.slice(0, 7))
      assert.equal(
        text(link),
        text(link).trim(),
        "no padding inside nav links",
      );
    const labels = links.map(text);
    if (n.attrs.some((a) => a.name === "class" && a.value === "phone-nav"))
      assert.match(
        t,
        /Ask AI Feedback GitHub /,
        "phone-menu utility links also need spaces",
      );
    assert.ok(
      t.startsWith(labels.slice(0, 7).join(" ") + " "),
      "navigation requires literal spaces between labels, not indentation",
    );
  }
  for (const c of n.childNodes || []) walk(c);
}
walk(parse(markup));
assert.equal(navCount, 2, "desktop and phone navigation were both checked");
assert.match(
  text(parse(connect[1].body)),
  /Copy\s+Ask Claude\s+Ask ChatGPT/,
  "buttons and Ask links need separators",
);
assert.match(
  text(parse(home)),
  /Connect Claude\s+Connect ChatGPT\s+Other assistants/,
  "CTA links need separators",
);
assert.match(
  text(parse(markup)),
  /What is this\?\s+Sources and report card/,
  "footer links need separators",
);
const guard = JSON.parse(read("wrangler.jsonc"));
assert.match(guard.build.command, /refuse-wrangler-deploy/);
const refusal = spawnSync(
  process.execPath,
  ["scripts/refuse-wrangler-deploy.mjs"],
  { cwd: root, encoding: "utf8" },
);
assert.equal(refusal.status, 1);
assert.match(refusal.stderr, /cf deploy/);
let section = "";
for (const line of STATIC_HEADERS.split("\n")) {
  if (line && !/^\s/.test(line)) section = line;
  if (/max-age=31536000|immutable/.test(line))
    assert.ok(
      !section.includes("*") ||
        ["/_astro/*", "/share/static/*"].includes(section),
      "immutable wildcards must use status-aware Worker routing",
    );
}
assert.match(
  STATIC_HEADERS,
  /\/_astro\/\*\n  Cache-Control: public, max-age=31536000, immutable/,
  "existing hashed Astro assets keep immutable caching",
);
if (
  process.argv.includes("--built") ||
  process.argv.includes("--built-assets")
) {
  const source = read("dist/_headers");
  const packaged = read(".astro-build/client/_headers");
  assert.equal(packaged, source, "adapter must preserve our header policy");
  for (const [k, v] of Object.entries(SECURITY_HEADERS))
    assert.ok(packaged.includes(`  ${k}: ${v}`));
  let rule = "";
  for (const line of packaged.split("\n")) {
    if (line && !/^\s/.test(line)) rule = line;
    if (/max-age=31536000|immutable/.test(line)) {
      assert.ok(
        !rule.includes("*") || ["/_astro/*", "/share/static/*"].includes(rule),
        "immutable wildcard needs status-aware routing",
      );
      assert.ok(
        rule.includes("*") || existsSync(`${root}/.astro-build/client${rule}`),
        `immutable rule names a missing file: ${rule}`,
      );
    }
  }
  assert.ok(
    existsSync(`${root}/.astro-build/client/index.html`),
    "clean build packages generated pages",
  );
  assert.ok(existsSync(`${root}/.astro-build/client/404.html`));
  if (process.argv.includes("--built")) {
    const redirect = JSON.parse(read(".wrangler/deploy/config.json"));
    assert.equal(redirect.configPath, "../../wrangler.jsonc");
    const deploy = spawnSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", "deploy", "--dry-run"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    assert.notEqual(deploy.status, 0, "plain wrangler deploy must refuse");
    assert.match(
      deploy.stdout + deploy.stderr,
      /Direct Wrangler deployment is disabled.*cf deploy/,
    );
  }
}
const origin = process.argv.find((a) => /^https?:/.test(a));
if (origin) {
  const { readdirSync } = await import("node:fs");
  const astroAsset = readdirSync(`${root}/.astro-build/client/_astro`)[0];
  const card = JSON.parse(read("dist/data/share-cards.json"))[0].image;
  for (const path of [`/_astro/${astroAsset}`, card]) {
    for (const method of ["GET", "HEAD"]) {
      const r = await fetch(origin + path, { method });
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get("cache-control"), /max-age=31536000/);
      assert.match(r.headers.get("cache-control"), /immutable/);
      if (method === "GET") {
        assert.deepEqual(
          Buffer.from(await r.arrayBuffer()),
          readFileSync(`${root}/.astro-build/client${path}`),
        );
        const etag = r.headers.get("etag");
        assert.ok(etag, "assets retain validators");
        const cached = await fetch(origin + path, {
          headers: { "If-None-Match": etag },
        });
        assert.equal(cached.status, 304);
        assert.match(cached.headers.get("cache-control"), /immutable/);
        assert.equal(await cached.text(), "");
      }
    }
  }
  for (const path of ["/_astro/missing.js", "/share/static/missing.png"]) {
    for (const method of ["GET", "HEAD"]) {
      const r = await fetch(origin + path, { method });
      assert.equal(r.status, 404);
      assert.equal(r.headers.get("cache-control"), "no-store");
    }
  }
  for (const [path, status] of [
    ["/search//?q=x", 301],
    ["/search///?q=x", 301],
    ["/receipt//?income=55000", 301],
    ["/about//", 307],
    ["/supplier/%25252525252525252525252561/", 404],
    ["/_astro/missing.js", 404],
    ["/fonts/missing.woff2", 404],
    ["/share/static/missing.png", 404],
    ["/data/missing.json", 404],
    ["/not-found/", 404],
    ["/", 200],
    ["/search/?q=snow+clearing", 200],
  ]) {
    const r = await fetch(origin + path, { redirect: "manual" });
    assert.equal(r.status, status, path);
    for (const [k, v] of Object.entries(SECURITY_HEADERS))
      assert.equal(
        r.headers.get(k),
        k === "Referrer-Policy" && path.startsWith("/receipt")
          ? "no-referrer"
          : v,
        `${path}: ${k}`,
      );
    if (status === 404)
      assert.ok(
        !/immutable|max-age=31536000/.test(
          r.headers.get("cache-control") || "",
        ),
        path,
      );
    if (path.includes("%25")) assert.match(await r.text(), /not found/i);
  }
}
console.log(
  "astro edges: entry responses, encoding depths/methods, inline separators, deployment guard, dependency and packaged headers pass",
);
