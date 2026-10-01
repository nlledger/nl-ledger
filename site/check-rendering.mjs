// Compare two builds from the same frozen data snapshot.
// node site/check-rendering.mjs /path/to/before/dist /path/to/after/dist
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "parse5";

const [before, after] = process.argv.slice(2);
if (!before || !after)
  throw new Error("Supply the before and after dist directories");
const bytes = (root, file) => readFileSync(join(root, file));
const cards = (root) => JSON.parse(bytes(root, "data/share-cards.json"));
const oldCards = new Map(cards(before).map((card) => [card.path, card]));
const imageNames = new Map();
let imageCount = 0;
for (const card of cards(after)) {
  const old = oldCards.get(card.path);
  assert.ok(old, `New share-card page: ${card.path}`);
  assert.deepEqual(
    { ...card, image: old.image },
    old,
    `Share metadata: ${card.path}`,
  );
  assert.deepEqual(
    bytes(after, card.image),
    bytes(before, old.image),
    `Share pixels: ${card.path}`,
  );
  imageNames.set(card.image, old.image);
  oldCards.delete(card.path);
  imageCount++;
}
assert.equal(oldCards.size, 0, "No share-card pages removed");
// Image names include dependency/template source hashes. Remap only after proving byte identity.
const normalizeImage = (value) =>
  value.replace(
    /\/share\/static\/[a-f0-9]+\.png/g,
    (name) => imageNames.get(name) || name,
  );
function canonical(node) {
  if (node.nodeName === "#text")
    return { tag: "#text", text: node.value.replace(/\s+/g, " ").trim() };
  const children = node.childNodes || node.content?.childNodes;
  return {
    tag: node.tagName || node.nodeName,
    attrs: node.attrs
      ?.map(({ name, value }) => [name, normalizeImage(value)])
      .sort(([a], [b]) => a.localeCompare(b)),
    children: children
      ?.map((child) => {
        // Structured data must keep values exactly, including whitespace inside strings.
        if (
          node.tagName === "script" &&
          node.attrs?.some(
            (a) => a.name === "type" && a.value === "application/ld+json",
          )
        ) {
          return { tag: child.nodeName, json: JSON.parse(child.value) };
        }
        return canonical(child);
      })
      .filter((child) => child.tag !== "#text" || child.text),
  };
}
const pages = (root) =>
  readdirSync(root, { recursive: true })
    .filter((file) => file.endsWith(".html"))
    .sort();
assert.deepEqual(pages(after), pages(before), "Same HTML routes");
for (const file of pages(before)) {
  assert.deepEqual(
    canonical(parse(bytes(after, file).toString())),
    canonical(parse(bytes(before, file).toString())),
    file,
  );
}
for (const file of [
  "app.js",
  "site.css",
  "og.png",
  "sitemap.xml",
  "robots.txt",
]) {
  assert.deepEqual(bytes(after, file), bytes(before, file), file);
}
console.log(
  `PASS: ${pages(before).length} HTML pages identical; ${imageCount} share PNGs byte-identical; app.js, CSS, generic image, sitemap and robots unchanged.`,
);
