// Astro's adapter reads Wrangler JSON; cf remains the deployment configuration.
import { writeFileSync } from "node:fs";
import config from "../cloudflare.config.ts";
const worker = config.worker;
const bindings = Object.entries(worker.env);
writeFileSync(
  "wrangler.astro.json",
  JSON.stringify(
    {
      name: worker.name,
      main: "@astrojs/cloudflare/entrypoints/server",
      compatibility_date: worker.compatibilityDate,
      compatibility_flags: worker.compatibilityFlags,
      workers_dev: worker.workersDev,
      preview_urls: worker.previewUrls,
      assets: {
        binding: "ASSETS",
        run_worker_first: worker.assets.runWorkerFirst,
        not_found_handling: worker.assets.notFoundHandling,
      },
      d1_databases: bindings
        .filter(([, b]) => b.type === "d1")
        .map(([binding, b]) => ({
          binding,
          database_name: b.name,
          database_id: b.id,
        })),
      ai: { binding: "AI" },
      vectorize: bindings
        .filter(([, b]) => b.type === "vectorize")
        .map(([binding, b]) => ({ binding, index_name: b.name })),
      ratelimits: bindings
        .filter(([, b]) => b.type === "rate-limit")
        .map(([name, b]) => ({
          name,
          namespace_id: b.namespace,
          simple: b.simple,
        })),
      send_email: bindings
        .filter(([, b]) => b.type === "send-email")
        .map(([name]) => ({ name })),
      vars: Object.fromEntries(
        bindings
          .filter(([, b]) => b.type === "text")
          .map(([name, b]) => [name, b.value]),
      ),
      limits: { cpu_ms: worker.limits.cpuMs },
      observability: {
        enabled: worker.observability.enabled,
        redact_query_string: worker.observability.redactQueryString,
      },
    },
    null,
    2,
  ),
);
