// Portable regression for the server shell, browser context, and maintained log configuration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { layout, feedbackForm } from "./lib/html.mjs";
import { page } from "./routes/_shared.js";
import { cleanPage } from "./routes/feedback.js";
const raw = "/receipt/?income=55009&income=55010&other=kept";
const form = await feedbackForm({ page: raw });
assert.ok(
  !form.includes("55009") && !form.includes("55010"),
  "shared feedback form removes receipt income",
);
const ctx = { request: new Request("https://nlledger.ca" + raw), env: {} };
const html = await (
  await page(
    ctx,
    { updated: "2026-09-30" },
    { title: "Receipt", body: "", path: "/receipt/" },
  )
).text();
assert.ok(
  !html.includes("55009") && !html.includes("55010"),
  "Worker shell removes income from feedback context",
);
for (const path of [
  raw,
  "/receipt?%69ncome=55009",
  "/receipt/child?income=55009",
  "/%72eceipt/?income=55009",
])
  assert.ok(
    !/55009|income/.test(cleanPage(path)),
    "storage input removes every receipt query",
  );
assert.equal(
  cleanPage("/search/?q=roads"),
  "/search/?q=roads",
  "search context retains words",
);
assert.ok(
  (await layout({ title: "T", body: "", at: raw })).includes(
    'name="page" value="/receipt/"',
  ),
  "static shell also redacts context",
);
const app = readFileSync(new URL("./static/app.js", import.meta.url), "utf8");
const snippet = app.slice(
  app.indexOf("// File the note under"),
  app.indexOf("    const here = at.value;"),
);
for (const [pathname, search, expected] of [
  ["/receipt/", "?income=55009", "/receipt/"],
  ["/search/", "?q=roads", "/search/?q=roads"],
]) {
  const at = { value: "/" };
  runInNewContext(snippet, { at, location: { pathname, search } });
  assert.equal(
    at.value,
    expected,
    "browser enhancement cannot put income back",
  );
}
const config = readFileSync(
  new URL("./cloudflare.config.ts", import.meta.url),
  "utf8",
);
assert.match(
  config,
  /observability:\s*\{[^}]*redactQueryString:\s*true/,
  "deploy configuration requests supported query redaction",
);
const receipt = readFileSync(
  new URL("./routes/receipt/index.js", import.meta.url),
  "utf8",
);
assert.match(
  receipt,
  /get\("income"\)/,
  "shared GET receipt links still calculate the supplied income",
);
assert.match(
  receipt,
  /set\("referrer-policy",\s*"no-referrer"\)/,
  "income cannot propagate through the receipt's outgoing Referer",
);
console.log(
  "Receipt privacy: static, Worker, browser, storage input, shared links and log configuration pass",
);
