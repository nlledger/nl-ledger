// Dataset structured data: every schema.org Dataset, top-level or nested, carries a description of 50 to 5000
// characters, a creator and a licence (Google drops a Dataset without a description from Dataset Search).
// Citations of a publisher's page are CreativeWork, which Google does not validate as a Dataset.
// Runs on the builders always, and on every built page when dist/ exists.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { datasetLd, LICENSE } from "./src/seo.mjs";

export function datasetProblems(node, where, out = []) {
  if (Array.isArray(node)) node.forEach((n, i) => datasetProblems(n, `${where}[${i}]`, out));
  else if (node && typeof node === "object") {
    const t = [].concat(node["@type"] || []);
    if (t.includes("Dataset")) {
      const len = String(node.description || "").length;
      if (len < 50 || len > 5000) out.push(`${where}: description ${len} characters (need 50 to 5000)`);
      if (!node.creator) out.push(`${where}: no creator`);
      if (!node.license || (Array.isArray(node.license) && !node.license.length)) out.push(`${where}: no license`);
    }
    for (const [k, v] of Object.entries(node)) datasetProblems(v, `${where}.${k}`, out);
  }
  return out;
}

const problems = [];
let pages = 0, datasets = 0;
const dist = join(import.meta.dirname, "dist");
if (existsSync(dist)) {
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".html")) {
        pages++;
        for (const m of readFileSync(p, "utf8").matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
          const j = JSON.parse(m[1]);
          datasets += (m[1].match(/"@type":"Dataset"/g) || []).length;
          datasetProblems(j, p.slice(dist.length), problems);
        }
      }
    }
  })(dist);
}
for (const p of problems) console.log(`FAIL: ${p}`);
console.log(`dataset JSON-LD: ${pages} built pages, ${datasets} Datasets, ${problems.length ? problems.length + " problems" : "pass"}`);
// The builder refuses a Dataset Google would reject, and cites publishers as CreativeWork.
const ok = { name: "n", path: "/x/", description: "x".repeat(60), license: LICENSE.provincial, publishers: [{ name: "P", url: "https://example.org/" }] };
assert.deepEqual(datasetProblems(datasetLd(ok), "ok"), []);
assert.equal(datasetLd(ok).isBasedOn[0]["@type"], "CreativeWork");
assert.throws(() => datasetLd({ ...ok, description: undefined }), /description/);
assert.throws(() => datasetLd({ ...ok, description: "too short" }), /description/);
assert.throws(() => datasetLd({ ...ok, license: undefined }), /license/);
assert.ok(datasetProblems({ "@type": "Dataset", name: "bare" }, "bare").length === 3);

process.exit(problems.length ? 1 : 0);
