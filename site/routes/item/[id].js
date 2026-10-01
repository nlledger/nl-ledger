import { getItem } from "../../lib/search.mjs";
import { itemPage, itemMeta } from "../../lib/views.mjs";
import { recordIndexable } from "../../lib/indexing.mjs";
import { assets, page, cached } from "../_shared.js";

export async function onRequestGet(ctx) {
  return cached(ctx, async () => {
    const a = await assets(ctx);
    const id = String(ctx.params.id || "").toLowerCase();
    const it = await getItem(ctx.env.DB, id);
    if (!it) {
      const body = `<header class="pagehead"><div class="wrap"><h1>No such record</h1><p class="lede">That record is not in the ledger. <a href="/search/">Search</a> instead.</p></div></header>`;
      return await page(ctx, a, {
        title: "Not found",
        body,
        status: 404,
        maxAge: 300,
      });
    }
    const v = await itemPage(it, a);
    const meta = itemMeta(it);
    return await page(ctx, a, {
      title: meta.title,
      description: meta.description,
      body: v.body,
      robots: recordIndexable(it) ? "" : "noindex,follow",
    });
  });
}
