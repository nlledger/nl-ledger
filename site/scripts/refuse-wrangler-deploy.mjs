console.error(
  "Direct Wrangler deployment is disabled. Run cf deploy from site/ so domains, bindings and secrets come from cloudflare.config.ts.",
);
process.exit(1);
