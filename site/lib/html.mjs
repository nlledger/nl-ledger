import { icon } from "./icons.mjs";
export { icon } from "./icons.mjs";
import { renderComponent } from "../lib/render.mjs";
import { feedbackContext } from "./privacy.mjs";
// Page shell and the accounting-schedule components. Used by the static build and by
// the Worker routes, so every page, static or rendered on request, is one design.
import { mobileTables } from "./tables.mjs";
import { RECEIPT_ASSUMPTIONS } from "./receipt.mjs";
import { SITE, money, moneyShort, date as fmtDate } from "./format.mjs";

export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const html = (strings, ...vals) =>
  strings.reduce(
    (out, s, i) =>
      out +
      s +
      (i < vals.length
        ? Array.isArray(vals[i])
          ? vals[i].join("")
          : (vals[i] ?? "")
        : ""),
    "",
  );

// Every entry point uses the same assumptions and associated field error.
export async function receiptForm({
  id,
  value = "",
  button = "Update",
  error = "",
} = {}) {
  return await renderComponent("components_ReceiptForm_astro", {
    id,
    RECEIPT_ASSUMPTIONS,
    value,
    error,
    button,
  });
}

// ---- icons: one stroke family, 1.6px, drawn on a 20px grid
// The brand: the name alone, cut from Archivo (see brand/). Outlined so it needs no font and takes the masthead's ink.

// ---- receipts: footnotes that point at the source file and page
export class Notes {
  constructor() {
    this.list = [];
  }
  // Returns a superscript marker. Same source+page+label reuses its number.
  cite({ url, page, label, locator }) {
    const href =
      url && page && /\.pdf($|\?)/i.test(url) ? `${url}#page=${page}` : url;
    const key = `${href}|${label}`;
    let n = this.list.findIndex((x) => x.key === key) + 1;
    if (!n) {
      this.list.push({ key, href, label, locator });
      n = this.list.length;
    }
    return `<sup class="fn"><a href="#note-${n}" id="ref-${n}-${this.list.length}" aria-label="Source note ${n}">${n}</a></sup><span class="cite-source"><a href="${esc(href || `#note-${n}`)}" aria-label="Source ${n}: ${esc(label)}" rel="noopener">Source ${n} ${icon("out")}</a></span>`;
  }
  async render() {
    if (!this.list.length) return "";
    return await renderComponent("components_Notes_astro", {
      list: this.list,
      icon,
    });
  }
}

// Link to one row's source: "p. 12" opens the PDF at that page.
export function receipt(url, page, locator, label) {
  if (!url) return "";
  const pdf = /\.pdf($|\?)/i.test(url);
  const href = pdf && page ? `${url}#page=${page}` : url;
  const text = label
    ? esc(label)
    : pdf && page
      ? `p.&nbsp;${esc(page)}`
      : "source";
  return `<a class="rcpt" href="${esc(href)}" rel="noopener" title="${esc(locator || "Open the source record")}">${text}</a>`;
}

// Graphite margin mark for a flag: a question, never an alarm.
export function query(flags, catalog) {
  if (!flags?.length) return "";
  const names = flags.map((f) => catalog?.[f]?.title || f);
  return `<a class="q" href="/flags/${esc(flags[0])}/" title="${esc(names.join("; "))}">${icon("query")}<span class="vh">Flagged: ${esc(names.join("; "))}</span></a>`;
}

export function bar(value, max, cls = "") {
  const w = max > 0 ? Math.max(0.4, (value / max) * 100) : 0;
  return `<span class="bar ${cls}" aria-hidden="true"><span style="inline-size:${w.toFixed(2)}%"></span></span>`;
}

// The site's standing statement, shown in the page head wherever a reader meets flags or named people.
export const STANDING =
  "A flag is a question, not a finding. It is not evidence that anything wrong happened.";
export const standing = () =>
  `<p class="standing">${icon("query")}<span>${STANDING}</span></p>`;

// One row of a list of patterns: the title is the way in, the method link is the aside.
export function flagItem(f, { count = "", method = false } = {}) {
  return `<li class="flagitem"><span class="q" aria-hidden="true">${icon("query")}</span><h3><a href="/flags/${f.id}/">${esc(f.title)}${icon("arrow")}</a></h3><span class="count">${count}</span><p>${esc(f.short)}${method ? ` <a class="method" href="/method/${f.id}/">Method<span class="vh"> for ${esc(f.title)}</span></a>` : ""}</p></li>`;
}

// ---- the open-source repository
export const REPO = "https://github.com/nlledger/nl-ledger";

// Closing block of a method page: where the code lives, and the way to challenge the method.
// files: [path, what it does]. Each links to the file on GitHub.
export async function methodCode(files, { title, path }) {
  const form = `${REPO}/issues/new?template=challenge-method.yml&page=${encodeURIComponent(`${SITE.url}${path}`)}&title=${encodeURIComponent(`Method: ${title}`)}`;
  return await renderComponent("components_MethodCode_astro", {
    files,
    REPO,
    form,
    icon,
  });
}

// ---- layout
const NAV = [
  ["/priorities/", "Priorities"],
  ["/budget/", "Budget"],
  ["/search/", "Search"],
  ["/flags/", "Patterns"],
  ["/members/", "Members"],
  ["/sources/", "Receipts"],
  ["/data/", "Ask AI"],
];

// The "Spot an error?" line at the foot of supplier, people and record pages.
export const spotError = () =>
  `<p class="spot-error small muted"><span>Spot an error?</span> <a href="#feedback">Say so in the box below</a>, or email <a href="mailto:${SITE.corrections}?subject=Correction%20request">${SITE.corrections}</a>. <a href="/about/#corrections">What to send</a>.</p>`;

// ---- the feedback box (routes/feedback.js receives it; NOTES.md "Feedback box")
export const FEEDBACK_KINDS = [
  ["wrong", "Something's wrong"],
  ["idea", "I have an idea"],
  ["confused", "This confused me"],
  ["question", "A question"],
];

export const FEEDBACK_MAX = 2000;
// Turnstile site key: public by design, it only names the widget. The test key (always passes, for ./dev.sh)
// comes from the environment; the matching secret is the Worker secret TURNSTILE_SECRET.
const TURNSTILE_SITEKEY =
  globalThis.process?.env?.NL_LEDGER_TURNSTILE_SITEKEY ||
  "0x4AAAAAAFKKld3Sh1vJesTV";

// The form itself. `page` is the address the note is about; `note`, `email`, `kind` and `error` are set only
// when the server hands a visitor's own note back to them to fix.
export async function feedbackForm({
  page = "/",
  note = "",
  email = "",
  kind = "",
  error = "",
  field = "",
} = {}) {
  return await renderComponent("components_FeedbackForm_astro", {
    TURNSTILE_SITEKEY,
    feedbackContext,
    page,
    error,
    icon,
    FEEDBACK_KINDS,
    kind,
    FEEDBACK_MAX,
    field,
    note,
    email,
  });
}

// The box at the foot of every page.
export async function feedbackBox(page) {
  return await renderComponent("components_FeedbackBox_astro", {
    icon,
    feedbackForm,
    page,
  });
}

// ---- structured data (JSON-LD). Escaped so a record's text can never close the script tag.
export const ldScript = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")}</script>`;
const plain = (h) =>
  String(h)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

// A BreadcrumbList from the page's own breadcrumb line (<p class="crumbs">), so every page that shows crumbs also declares them.
export function breadcrumbList(body, path) {
  const m = String(body).match(/<p class="crumbs">(.*?)<\/p>/s);
  if (!m) return null;
  const parts = m[1].split(" / ").map((x) => {
    const a = x.match(/^<a href="([^"]*)">(.*)<\/a>$/s);
    return a
      ? { href: a[1], name: plain(a[2]) }
      : { href: null, name: plain(x) };
  });
  if (parts.length < 2) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: parts.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${SITE.url}${c.href || path}`,
    })),
  };
}

// `feedback: false` leaves the box out (pages that carry the form in their own body); `at` is the address a note
// from this page is filed under, when it differs from the canonical path (a search with its query).
export async function layout({
  title,
  description,
  path = "/",
  body,
  notes,
  bodyClass = "",
  head = "",
  scripts = "",
  updated,
  jsonld = [],
  robots = "",
  feedback = true,
  at,
  share = null,
  sharePath = path,
  shareOrigin = SITE.url,
}) {
  const full = title
    ? `${title} · ${SITE.name}`
    : `${SITE.name}: ${SITE.tagline}`;
  const desc =
    description ||
    "Provincial accounts and federal records linked to NL addresses, with sources and location evidence.";
  const crumbs = breadcrumbList(body, path);
  const ld = [...(crumbs ? [crumbs] : []), ...jsonld].map(ldScript).join("\n");
  return await renderComponent("layouts_Layout_astro", {
    full,
    desc,
    SITE,
    path,
    shareOrigin,
    sharePath,
    share,
    robots,
    ASSET_VERSION,
    head,
    ld,
    bodyClass,
    NAV,
    icon,
    feedback,
    REPO,
    mobileTables,
    body,
    notes,
    feedbackBox,
    at,
    STANDING,
    updated,
    fmtDate,
    scripts,
  });
}

export let ASSET_VERSION = "1";
export function setAssetVersion(v) {
  ASSET_VERSION = v;
}

// A schedule: the Estimates-book table. rows: [{label, cells:[...], cls, href}], cols: [{label, num}]
export async function schedule({
  caption,
  cols,
  rows,
  foot,
  id,
  compact = false,
  pin = true,
}) {
  return mobileTables(
    await renderComponent("components_Schedule_astro", {
      id,
      compact,
      pin,
      caption,
      cols,
      rows,
      foot,
    }),
  );
}

// Leader list: label ........ figure
export function leaders(items) {
  return html`<dl class="leaders">
    ${items.map(
      (x) =>
        html`<div${x.cls ? ` class="${x.cls}"` : ""}><dt><span>${x.label}</span></dt><dd>${x.value}</dd></div>`,
    )}
  </dl>`;
}

export function pager(base, page, more) {
  const prev =
    page > 1
      ? `<a rel="prev" href="${base}&page=${page - 1}">Previous</a>`
      : "";
  const next = more
    ? `<a rel="next" href="${base}&page=${page + 1}">Next ${icon("arrow")}</a>`
    : "";
  return prev || next
    ? `<nav class="pager" aria-label="Pages">${prev}${next}</nav>`
    : "";
}

export { money, moneyShort };
