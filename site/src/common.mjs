import {
  components_ItemRow_astro as ItemRow,
  components_FederalSummary_astro as FederalSummary,
} from "../.render/components.mjs";
import { renderAstro } from "../lib/render.mjs";
// Helpers shared by the page builders.

import { DATASET_LABEL } from "../lib/format.mjs";
export function supplierHref(D, supplierKey) {
  return supplierKey ? `/supplier/${D.keyHash(supplierKey)}/` : null;
}

// A public body's page is named after its most common printing (the buyers table), so any
// printing of its name links to the one page.
let bodyNames = null;
export function bodyHref(D, name) {
  bodyNames ||= new Map(
    D.q(
      `SELECT DISTINCT i.buyer, b.buyer canon FROM items i JOIN buyers b USING (buyer_key)`,
    ).map((r) => [r.buyer, r.canon]),
  );
  return `/body/${D.slug(bodyNames.get(name) || name)}/`;
}

// The same query bodies.mjs uses, so a link is written exactly when that page is.
// A link to a public body's page when the build writes one, plain text otherwise (a pattern can name a body
// under a spelling that has no page of its own).
let bodySlugs = null;
export function bodyAnchorHref(D, name) {
  bodySlugs ||= new Set(
    D.q(
      `SELECT (SELECT buyer FROM buyers WHERE buyers.buyer_key = items.buyer_key) buyer
      FROM items WHERE dataset IN ('ppa','fed_contract','fed_grant','canadabuys','paradise','stjohns') AND buyer IS NOT NULL GROUP BY buyer_key`,
    ).map((r) => `/body/${D.slug(r.buyer)}/`),
  );
  const href = bodyHref(D, name);
  return bodySlugs.has(href) ? href : null;
}
export async function itemRow(D, it, options = {}) {
  return renderAstro(ItemRow, {
    D,
    it,
    ...options,
  });
}
export const ITEM_COLS = [
  {
    label: "Supplier and description",
  },
  {
    label: "Date",
    w: "7.5rem",
  },
  {
    label: "Amount",
    num: true,
    w: "8rem",
  },
  {
    label: "Source",
    num: true,
    w: "6.5rem",
  },
];
export function datasetLabel(ds) {
  return DATASET_LABEL[ds] || ds;
}
export async function federalSummary(D, where, ...args) {
  return renderAstro(FederalSummary, {
    D,
    where,
    args,
  });
}
