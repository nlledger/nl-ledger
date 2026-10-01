import { existsSync } from "node:fs";
import { bindings, defineConfig } from "cf/config";

// Deploy settings come from the environment, or from site/.env (see .env.example).
if (existsSync(".env")) process.loadEnvFile(".env");
const env = (name: string) => process.env[name] ?? "";

// Astro packages the static pages from dist and the existing Worker dispatcher together.
// Only runWorkerFirst paths execute the dispatcher; other requests use the asset binding.
// NL_LEDGER_PREVIEW=1 deploys the same code and bindings as a second Worker, nlledger-preview, on its
// workers.dev address and leaves the live site alone: for trying a change against the real D1, mail and
// Turnstile before it goes live (NOTES.md "Preview copy").
const astroPreview = env("NL_LEDGER_ASTRO_PREVIEW") === "1";
const cardsPreview = env("NL_LEDGER_CARDS_PREVIEW") === "1";
const preview =
  astroPreview || cardsPreview || env("NL_LEDGER_PREVIEW") === "1";

export default defineConfig({
  accountId: env("CLOUDFLARE_ACCOUNT_ID"),
  worker: {
    name: astroPreview
      ? "nlledger-astro-preview"
      : cardsPreview
        ? "nlledger-cards-preview"
        : preview
          ? "nlledger-preview"
          : "nlledger",
    compatibilityDate: "2026-09-01",
    limits: { cpuMs: 1000 },
    entrypoint: "./.astro-build/server/entry.mjs",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      notFoundHandling: "404-page",
      // Every other path is a static asset: free and unlimited, not counted against 100,000 requests a day.
      runWorkerFirst: [
        "/share/dynamic/*",
        "/search",
        "/search/*",
        "/supplier/*",
        "/item/*",
        "/receipt",
        "/receipt/*",
        "/feedback",
        "/feedback/*",
        "/mcp",
        "/mcp/*",
        "/.well-known/ai-catalog.json",
      ],
    },
    domains: astroPreview
      ? []
      : cardsPreview
        ? ["cards-preview.nlledger.ca"]
        : preview
          ? []
          : ["nlledger.ca"],
    workersDev: preview,
    previewUrls: false,
    observability: { enabled: true, redactQueryString: true },
    env: {
      ASSETS: bindings.assets(),
      ...(cardsPreview
        ? {
            SHARE_ORIGIN: {
              type: "text",
              value: "https://cards-preview.nlledger.ca",
            },
          }
        : {}),
      DB: bindings.d1({ id: env("NL_LEDGER_D1_ID"), name: "nl-ledger" }),
      // Search by meaning (lib/meaning.mjs, NOTES.md "Search"): Workers AI turns the query into a vector,
      // Vectorize finds the closest search documents (filled by pipeline/vectorize_sync.py), and the rate
      // limit caps how many queries per minute, per Cloudflare location, may reach either.
      AI: bindings.ai({}),
      MEANING: bindings.vectorize({ name: "nl-ledger-meaning" }),
      SHARE_RENDER_LIMIT: bindings.rateLimit({
        namespace: "350",
        simple: { limit: 20, period: 60 },
      }),
      MEANING_LIMIT: bindings.rateLimit({
        namespace: "346",
        simple: { limit: 30, period: 60 },
      }),
      // The feedback box (routes/feedback.js, NOTES.md "Feedback box"): notes are emailed from an address on the
      // domain, and one network address may post four times a minute. The two secrets are set once on the
      // Worker (NOTES.md has the commands); naming them here is what makes a deploy keep them.
      ...(cardsPreview
        ? {}
        : {
            TURNSTILE_SECRET: bindings.secret(),
            FEEDBACK_TO: bindings.secret(),
          }),
      MAIL: bindings.sendEmail({}),
      FEEDBACK_LIMIT: bindings.rateLimit({
        namespace: "349",
        simple: { limit: 4, period: 60 },
      }),
    },
  },
});
