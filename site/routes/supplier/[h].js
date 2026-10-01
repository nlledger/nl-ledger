import { supplierCard, dynamicShare } from "../../lib/share-card.mjs";
import { supplierPage } from "../../lib/views.mjs";
import { supplierIndexable } from "../../lib/indexing.mjs";
import { moneyWords } from "../../lib/format.mjs";
import { assets, page, cached } from "../_shared.js";

const SHARDS = 512;

export async function onRequestGet(ctx) {
  return cached(ctx, async () => {
    const a = await assets(ctx);
    const h = String(ctx.params.h || "").toLowerCase();
    let s = null;
    if (/^[0-9a-f]{10}$/.test(h)) {
      const n = parseInt(h.slice(0, 4), 16) % SHARDS;
      const res = await ctx.env.ASSETS.fetch(
        new URL(`/data/s/${n}.json`, ctx.request.url),
      );
      if (res.ok) s = (await res.json())[h] || null;
    }
    // A name this supplier is also printed under: its page is the supplier's. Temporary (302):
    // which name leads a group can change when the data is rebuilt.
    if (s?.to)
      return Response.redirect(
        new URL(`/supplier/${s.to}/`, ctx.request.url),
        302,
      );
    if (!s) {
      const body = `<header class="pagehead"><div class="wrap"><h1>No such supplier</h1><p class="lede">Nothing on record under that link. <a href="/search/">Search</a> for the name instead.</p></div></header>`;
      return await page(ctx, a, {
        title: "Not found",
        body,
        status: 404,
        maxAge: 300,
      });
    }
    const v = await supplierPage(s, { ...a, hash: h });
    const name = s.name;
    const text = `${moneyWords(s.total)} in included CAD record values; sources can overlap. Federal addresses do not locate work or benefits. Not total payments.`;
    return await page(ctx, a, {
      title: `${name}: government contracts and payments`,
      description: text,
      share: dynamicShare(supplierCard(s), a.version, "supplier", h),
      body: v.body,
      robots: supplierIndexable(s) ? "" : "noindex,follow",
    });
  });
}
