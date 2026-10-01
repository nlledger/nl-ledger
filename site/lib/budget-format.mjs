import { moneyWords } from "./format.mjs";
export const words = (v) =>
  v == null
    ? ""
    : Math.abs(v) >= 1e9
      ? `$${(Math.abs(v) / 1e9).toFixed(2)} billion`
      : moneyWords(Math.abs(v));
export const share = (v) =>
  v == null
    ? ""
    : `${v < 0 ? "(" : ""}${(Math.abs(v) * 100).toFixed(1)}%${v < 0 ? ")" : ""}`;
export const march = (fy) => `31 March ${Number(fy.slice(0, 4)) + 1}`;
