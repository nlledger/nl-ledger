import { renderComponent } from "../../lib/render.mjs";
import { renderReceipt } from "../../lib/receipt.mjs";
import { receiptForm, esc } from "../../lib/html.mjs";
import { money, num } from "../../lib/format.mjs";
import { assets, page } from "../_shared.js";

let R = null;
export async function onRequestGet(ctx) {
  const a = await assets(ctx);
  R ||= await (
    await ctx.env.ASSETS.fetch(new URL("/data/receipt.json", ctx.request.url))
  ).json();
  const raw = new URL(ctx.request.url).searchParams.get("income") || "";
  const cleaned = raw.replace(/[\s,$]/g, "");
  const valid = /^\d{1,8}(\.\d{0,2})?$/.test(cleaned);
  const income = valid
    ? Math.min(10_000_000, Math.floor(Number(cleaned)))
    : a.stats.median_annual_wage.value;
  const body = await renderComponent("components_ReceiptPage_astro", {
    R,
    receiptForm,
    raw,
    valid,
    num,
    income,
    money,
    a,
    renderReceipt,
  });
  const res = await page(ctx, a, {
    title: "NL employment income tax illustration",
    description: `Estimate ${esc(R.tax.year)} Newfoundland and Labrador provincial income tax for a single employee with one job and illustrate spending shares, using form NL428.`,
    body,
    path: "/receipt/",
    maxAge: 0,
  });
  res.headers.set("cache-control", "private, no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}
