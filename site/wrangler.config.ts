import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  // cf delegates to Astro; direct Wrangler builds use the same data/check/package hooks.
  ...(process.env.NL_LEDGER_ASTRO_BUILT === "1"
    ? {}
    : { build: { command: "astro build" } }),
  assetsDirectory: ".astro-build/client",
  rules: [{ type: "Data", globs: ["**/*.ttf"], fallthrough: true }],
});
