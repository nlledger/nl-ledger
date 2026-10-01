// Checks on the built pages (run by check.sh when dist/ exists): internal links land on a page, every JSON-LD
// block parses, every page has a unique description, and the sitemap lists no record or search pages.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SECURITY_HEADERS } from "./lib/headers.mjs";

const DIST = join(import.meta.dirname, "dist");
const RENDERED = /^\/(search|supplier|item|receipt|feedback|mcp|data|\.well-known)(\/|$)/; // rendered on request or data files, not in dist as pages
const files = [];
(function walk(d) { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : p.endsWith(".html") && files.push(p); } })(DIST);

const problems = [];
// Static pages and Worker HTML share the policy; versions describe emitted asset bytes.
const headers = readFileSync(join(DIST, "_headers"), "utf8").split("\n");
for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
  if (!headers.includes(`  ${name}: ${value}`)) problems.push(`static security header missing or different: ${name}`);
}
const version = JSON.parse(readFileSync(join(DIST, "data/version.json"), "utf8")).v;
const emitted = createHash("sha1").update(readFileSync(join(DIST, "site.css"))).update(readFileSync(join(DIST, "app.js"))).digest("hex").slice(0, 8);
if (version !== emitted) problems.push("asset version does not hash emitted CSS and JS");
const descs = new Map();
const linked = new Map();
for (const f of files) {
  const h = readFileSync(f, "utf8");
  const page = f.slice(DIST.length);
  for (const m of h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try { JSON.parse(m[1]); } catch { problems.push(`bad JSON-LD in ${page}`); }
  }
  const d = h.match(/name="description" content="([^"]*)"/)?.[1];
  if (!d) problems.push(`no description: ${page}`);
  else {
    // The share card (og and twitter) must carry the same description, whole and short enough not to be cut off.
    const text = d.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    if (text.length > 155) problems.push(`description over 155 characters (${text.length}): ${page}`);
    if (/…|\.\.\.$/.test(text)) problems.push(`description cut off with an ellipsis: ${page}`);
    for (const k of ["og:description", "twitter:description"]) {
      const c = h.match(new RegExp(`(?:property|name)="${k}" content="([^"]*)"`))?.[1];
      if (c !== d) problems.push(`${k} missing or different from the description: ${page}`);
    }
  }
  if (d && page !== "/404.html") (descs.get(d) || descs.set(d, []).get(d)).push(page);
  for (const m of h.matchAll(/href="(\/[^"#?]*)/g)) {
    const path = m[1];
    if (RENDERED.test(path) || path === "/") continue;
    const ok = existsSync(join(DIST, path)) && !path.endsWith("/") ? true : existsSync(join(DIST, path, "index.html"));
    if (!ok) (linked.get(path) || linked.set(path, []).get(path)).push(page);
  }
}
// Text escaped twice shows entities to readers ("K&amp;D"); flag any double-escaped entity.
for (const f of files) {
  const m = readFileSync(f, "utf8").match(/&amp;(amp|lt|gt|quot|#39|#x27|apos);/);
  if (m) problems.push(`double-escaped ${m[0]} in ${f.slice(DIST.length)}`);
}
for (const [d, pages] of descs) if (pages.length > 1) problems.push(`same description on ${pages.length} pages (${pages.slice(0, 3).join(", ")}): ${d.slice(0, 60)}`);
for (const [path, pages] of linked) problems.push(`broken link ${path} from ${pages[0]}${pages.length > 1 ? ` and ${pages.length - 1} more` : ""}`);
if (existsSync(join(DIST, "sitemap.xml"))) {
  const sm = readFileSync(join(DIST, "sitemap.xml"), "utf8");
  if (/<loc>[^<]*\/(item|search)\//.test(sm)) problems.push("sitemap lists record or search pages");
  if (/404\.html/.test(sm)) problems.push("sitemap lists 404.html");
} else problems.push("no sitemap.xml");
if (!existsSync(join(DIST, "robots.txt"))) problems.push("no robots.txt");
else if (!/^Sitemap: /m.test(readFileSync(join(DIST, "robots.txt"), "utf8"))) problems.push("robots.txt has no Sitemap line");

for (const p of problems) console.log(`FAIL: ${p}`);
console.log(`page checks: ${files.length} pages, ${problems.length ? problems.length + " problems" : "pass"}`);
process.exit(problems.length ? 1 : 0);
