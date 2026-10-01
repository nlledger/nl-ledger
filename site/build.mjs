// Compile before loading the builders' component imports, including on a clean checkout.
await import("./scripts/compile-astro.mjs");
await import("./build-site.mjs");
