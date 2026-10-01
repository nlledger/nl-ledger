import { components_InlineScript_astro as InlineScript } from "../.render/components.mjs";
import {
  components_ReceiptLink_astro as ReceiptLink,
  components_JsonLd_astro as JsonLd,
} from "../.render/components.mjs";
export const serializeJsonLd = (obj) =>
  JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
import {
  components_ReceiptForm_astro as ReceiptForm,
  components_FeedbackForm_astro as FeedbackForm,
  layouts_Layout_astro as Layout,
  components_Schedule_astro as Schedule,
} from "../.render/components.mjs";
export { icon } from "./icons.mjs";
import { renderAstro } from "../lib/render.mjs";
// Page shell and the accounting-schedule components. Used by the static build and by
// the Worker routes, so every page, static or rendered on request, is one design.
import { mobileTables } from "./tables.mjs";
import { SITE, money, moneyShort } from "./format.mjs";
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// Every entry point uses the same assumptions and associated field error.
export async function receiptForm({
  id,
  value = "",
  button = "Update",
  error = "",
} = {}) {
  return await renderAstro(ReceiptForm, {
    id,
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
      this.list.push({
        key,
        href,
        label,
        locator,
      });
      n = this.list.length;
    }
    return {
      n,
      ref: this.list.length,
      href,
      label,
    };
  }
}

// Link to one row's source: "p. 12" opens the PDF at that page.
export async function receipt(url, page, locator, label) {
  return renderAstro(ReceiptLink, {
    url,
    page,
    locator,
    label,
  });
}
// The site's standing statement, shown in the page head wherever a reader meets flags or named people.
export const STANDING =
  "A flag is a question, not a finding. It is not evidence that anything wrong happened.";
// ---- the open-source repository
export const REPO = "https://github.com/nlledger/nl-ledger";

// Closing block of a method page: where the code lives, and the way to challenge the method.
// files: [path, what it does]. Each links to the file on GitHub.

// ---- layout
export const NAV = [
  ["/priorities/", "Priorities"],
  ["/budget/", "Budget"],
  ["/search/", "Search"],
  ["/flags/", "Patterns"],
  ["/members/", "Members"],
  ["/sources/", "Receipts"],
  ["/data/", "Ask AI"],
];

// The "Spot an error?" line at the foot of supplier, people and record pages.

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
export const TURNSTILE_SITEKEY =
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
  return await renderAstro(FeedbackForm, {
    page,
    error,
    kind,
    field,
    note,
    email,
  });
}

// The box at the foot of every page.

// ---- structured data (JSON-LD). Escaped so a record's text can never close the script tag.
export async function ldScript(obj) {
  return renderAstro(
    JsonLd,
    {},
    {
      default: serializeJsonLd(obj),
    },
  );
}
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
      ? {
          href: a[1],
          name: plain(a[2]),
        }
      : {
          href: null,
          name: plain(x),
        };
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
  const ld = (
    await Promise.all([...(crumbs ? [crumbs] : []), ...jsonld].map(ldScript))
  ).join("\n");
  return mobileTables(
    await renderAstro(
      Layout,
      {
        assetVersion: ASSET_VERSION,
        full,
        desc,
        path,
        shareOrigin,
        sharePath,
        share,
        robots,
        bodyClass,
        feedback,
        notes,
        at,
        updated,
      },
      {
        theme: await renderAstro(
          InlineScript,
          {},
          {
            default:
              'try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}',
          },
        ),
        default: body,
        head,
        scripts,
        "structured-data": ld,
      },
      false,
    ),
  );
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
    await renderAstro(Schedule, {
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

export { money, moneyShort };
