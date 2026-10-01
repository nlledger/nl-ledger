// node site/check-astro-edge-rendering.mjs /path/to/main/dist /path/to/fixed/dist
// Keep the existing pixel/metadata parity check, then compare HTML byte-for-byte
// except for explicit separators between controls and proven share-image renames.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
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
const normalize = (html) =>
  html
    .replace(
      /\/share\/static\/[a-f0-9]+\.png/g,
      (name) => names.get(name) || name,
    )
    .replace(
      /<(nav|div) class="(nav|phone-nav|foot-nav|cta|ask-do)"[^>]*>[\s\S]*?<\/\1>/g,
      (group) => group.replace(/(<\/(?:a|button)>) (?=<)/g, "$1"),
    );
let count = 0,
  beforeBytes = 0,
  afterBytes = 0;
for (const file of readdirSync(before, { recursive: true }).filter((f) =>
  f.endsWith(".html"),
)) {
  const a = read(before, file),
    b = read(after, file);
  assert.equal(
    normalize(b),
    normalize(a),
    `${file}: only intended inter-control spaces may change`,
  );
  beforeBytes += Buffer.byteLength(a);
  afterBytes += Buffer.byteLength(b);
  count++;
}
console.log(
  `PASS: ${count} pages differ only in explicit inter-control separators and proven image-name mappings; HTML ${beforeBytes} -> ${afterBytes} bytes (+${afterBytes - beforeBytes}).`,
);
