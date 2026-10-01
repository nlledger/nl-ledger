// node site/check-astro-edge-rendering.mjs /path/to/main/dist /path/to/fixed/dist
// Keep the existing pixel/metadata parity check, then compare parsed HTML serialization,
// protected text and explicit separators alongside proven share-image names.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parse, serialize } from "parse5";
const [before, after] = process.argv.slice(2);
execFileSync(
  process.execPath,
  [new URL("./check-rendering.mjs", import.meta.url).pathname, before, after],
  { stdio: "inherit" },
);
const read = (root, file) => readFileSync(join(root, file), "utf8");
const old = new Map(
  JSON.parse(read(before, "data/share-cards.json")).map((c) => [
    c.path,
    c.image,
  ]),
);
const names = new Map(
  JSON.parse(read(after, "data/share-cards.json")).map((c) => [
    c.image,
    old.get(c.path),
  ]),
);
// Compare parsed serialization: direct components replace HTML strings, changing
// indentation and equivalent entity spelling. Keep protected text byte-exact and
// check whole control-group text separately so lost separators cannot hide.
const controlClasses = new Set([
  "nav",
  "phone-nav",
  "foot-nav",
  "cta",
  "ask-do",
]);
const text = (node) =>
  node.nodeName === "#text"
    ? node.value
    : (node.childNodes || []).map(text).join("");
const normalize = (html) => {
  const document = parse(
    html.replace(
      /\/share\/static\/[a-f0-9]+\.png/g,
      (name) => names.get(name) || name,
    ),
  );
  const controls = [];
  function walk(node) {
    if (["pre", "script", "style", "textarea"].includes(node.tagName)) return;
    if (
      node.attrs?.some(
        (a) =>
          a.name === "class" &&
          a.value.split(/\s+/).some((c) => controlClasses.has(c)),
      )
    )
      controls.push(text(node).replace(/\s+/g, " ").trim());
    if (node.nodeName === "#text")
      node.value = node.value.replace(/\s+/g, " ").trim();
    for (const child of node.childNodes || []) walk(child);
    for (const child of node.content?.childNodes || []) walk(child);
    if (node.childNodes)
      node.childNodes = node.childNodes.filter(
        (n) => n.nodeName !== "#text" || n.value,
      );
  }
  walk(document);
  return { html: serialize(document), controls };
};
let count = 0,
  beforeBytes = 0,
  afterBytes = 0;
for (const file of readdirSync(before, { recursive: true }).filter((f) =>
  f.endsWith(".html"),
)) {
  const a = read(before, file),
    b = read(after, file);
  assert.deepEqual(
    normalize(b),
    normalize(a),
    `${file}: structure, protected text and inter-control separators must match`,
  );
  beforeBytes += Buffer.byteLength(a);
  afterBytes += Buffer.byteLength(b);
  count++;
}
console.log(
  `PASS: ${count} pages match in structure, protected text and inter-control separators after serialization normalization; HTML ${beforeBytes} -> ${afterBytes} bytes (${afterBytes - beforeBytes >= 0 ? "+" : ""}${afterBytes - beforeBytes}).`,
);
