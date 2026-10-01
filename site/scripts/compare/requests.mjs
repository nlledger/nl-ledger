// Compare the same requests through two local Worker dispatchers. Never use the live site.
import fs from "node:fs";
import { parse } from "parse5";
import assert from "node:assert/strict";
const [before, after, beforeDist, afterDist] = process.argv.slice(2);
if (!afterDist)
  throw Error(
    "Usage: node site/scripts/compare/requests.mjs BEFORE_URL AFTER_URL BEFORE_DIST AFTER_DIST",
  );
for (const base of [before, after])
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
    "Use local Workers; feedback cases must never reach production",
  );
const routes = JSON.parse(
  fs.readFileSync(new URL("./routes.json", import.meta.url)),
);
const oldCards = JSON.parse(
  fs.readFileSync(beforeDist + "/data/share-cards.json"),
);
const newCards = JSON.parse(
  fs.readFileSync(afterDist + "/data/share-cards.json"),
);
const imageNames = new Map(
  newCards.map((c) => {
    const old = oldCards.find((b) => b.path === c.path);
    assert.ok(old, c.path);
    assert.deepEqual(
      fs.readFileSync(afterDist + c.image),
      fs.readFileSync(beforeDist + old.image),
      c.path + " PNG",
    );
    return [c.image, old.image];
  }),
);
const value = (text) =>
  text
    .replace(/\/share\/static\/[a-f0-9]+\.png/g, (x) => imageNames.get(x) || x)
    .replace(/\/share\/dynamic\/[a-f0-9]+\//g, "/share/dynamic/BUILD/");
function canonical(node) {
  const structured =
    node.tagName === "script" &&
    node.attrs?.some(
      (a) => a.name === "type" && a.value === "application/ld+json",
    );
  return {
    tag: node.tagName || node.nodeName,
    attrs: node.attrs
      ?.map((a) => [a.name, value(a.value)])
      .sort(([a], [b]) => a.localeCompare(b)),
    text:
      node.nodeName === "#text"
        ? node.value.replace(/\s+/g, " ").trim()
        : undefined,
    children: node.childNodes
      ?.map((c) => (structured ? { json: JSON.parse(c.value) } : canonical(c)))
      .filter((n) => n.tag !== "#text" || n.text),
  };
}
const cases = routes.map((route) => ({ route, method: "GET" }));
for (const route of [
  "/search/?q=snow+clearing",
  "/supplier/dd90d9cdad/",
  "/item/8038fab331ae/",
  "/receipt/?income=invalid",
  "/feedback/",
  "/missing-page/",
])
  for (const method of ["HEAD", "OPTIONS", "PUT"])
    cases.push({ route, method });
// Refusals stop before verification, storage and mail. No accepted notes are submitted.
for (const body of [
  "",
  "kind=correction&note=",
  "kind=correction&note=" + encodeURIComponent("x".repeat(2001)),
])
  cases.push({
    route: "/feedback/",
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
cases.push({
  route: "/feedback/",
  method: "POST",
  body: "note=refused",
  headers: {
    origin: "https://other.test",
    "content-type": "application/x-www-form-urlencoded",
  },
});
const differences = [];
for (const test of cases) {
  const label = test.method + " " + test.route;
  const responses = await Promise.all(
    [before, after].map((base) =>
      fetch(base + test.route, {
        method: test.method,
        headers: { origin: base, ...test.headers },
        body: test.body,
        redirect: "manual",
      }),
    ),
  );
  const [a, b] = responses;
  assert.deepEqual(
    [...a.headers].filter(([k]) => k !== "date"),
    [...b.headers].filter(([k]) => k !== "date"),
    label + " headers",
  );
  if (a.status !== b.status)
    differences.push({ label, status: [a.status, b.status] });
  const texts = await Promise.all(responses.map((r) => r.text()));
  const [x, y] = texts.map((text, i) => {
    text = text.replaceAll(
      `This form only works on ${new URL([before, after][i]).host}.`,
      "This form only works on WORKER_HOST.",
    );
    return JSON.stringify(
      responses[i].headers.get("content-type")?.includes("text/html")
        ? canonical(parse(text))
        : value(text),
    );
  });
  if (x !== y) {
    let i = 0;
    while (x[i] === y[i]) i++;
    differences.push({
      label,
      before: x.slice(Math.max(0, i - 100), i + 200),
      after: y.slice(Math.max(0, i - 100), i + 200),
    });
  }
}
console.log(
  `${cases.length} Worker request cases; ${differences.length} differences`,
);
if (differences.length) {
  console.log(differences.slice(0, 3));
  process.exitCode = 1;
}
