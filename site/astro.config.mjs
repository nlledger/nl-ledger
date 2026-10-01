import "./scripts/adapter-config.mjs";
import { ledgerBuild } from "./scripts/astro-build.mjs";
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  integrations: [ledgerBuild()],
  adapter: cloudflare({
    configPath: "./wrangler.astro.json",
    imageService: "passthrough",
    prerenderEnvironment: "node",
  }),
  output: "server",
  outDir: "./.astro-build",
  publicDir: "./dist",
  session: false,
  security: { checkOrigin: false }, // Existing Worker handlers enforce origins and response policies.
  devToolbar: { enabled: false },
});
