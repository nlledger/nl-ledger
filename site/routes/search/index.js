import { searchCard, dynamicShare } from "../../lib/share-card.mjs";
import { find } from "../../lib/search.mjs";
import { searchPage } from "../../lib/views.mjs";
import { assets, page, cached, searchIO } from "../_shared.js";

export async function onRequestGet(ctx) {
  return cached(ctx, async () => {
    const a = await assets(ctx);
    const url = new URL(ctx.request.url);
    const params = Object.fromEntries(url.searchParams);
    const pageNo = Math.min(
      50,
      Math.max(1, parseInt(params.page || "1", 10) || 1),
    );
    let result = null;
    try {
      result = await find(searchIO(ctx), params, { limit: 30, page: pageNo });
    } catch (e) {
      const body = `<header class="pagehead"><div class="wrap"><h1>Search</h1><p class="lede">That search could not run. Try plain words without symbols.</p><p><a href="/search/">Start again</a></p></div></header>`;
      return await page(ctx, a, {
        title: "Search",
        body,
        path: "/search/",
        sharePath: `/search/${url.search}`,
        status: 400,
        maxAge: 60,
        robots: "noindex",
      });
    }
    const title = params.q ? `Search: ${params.q}` : "Search";
    // Only the bare search page is indexed; every query, filter and page number (including a search with no results) is not.
    const bare = !Object.keys(params).some((k) => params[k] !== "");
    return await page(ctx, a, {
      title,
      description:
        "Search every provincial award, federal contract and grant, expense claim and pay record.",
      body: await searchPage({
        params,
        result,
        flags: a.flags,
        page: pageNo,
        links: a.links,
      }),
      path: "/search/",
      sharePath: `/search/${url.search}`,
      share: dynamicShare(searchCard(params.q), a.version, "search", params.q),
      robots: bare ? "" : "noindex,follow",
    });
  });
}
