// Compile the same Astro components for the data build, portable checks and Worker.
import { transform } from "@astrojs/compiler-rs";
import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
const root = resolve(import.meta.dirname, "..");
const files = readdirSync(resolve(root, "src"), { recursive: true })
  .filter((f) => f.endsWith(".astro"))
  .sort();
mkdirSync(resolve(root, ".render"), { recursive: true });
await build({
  absWorkingDir: root,
  stdin: {
    contents: files
      .map(
        (f) =>
          `export { default as ${f.replace(/[^a-zA-Z0-9]/g, "_")} } from ${JSON.stringify("./src/" + f)};`,
      )
      .join("\n"),
    resolveDir: root,
    sourcefile: "components.mjs",
  },
  outfile: resolve(root, ".render/components.mjs"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  packages: "external",
  plugins: [
    {
      name: "astro-components",
      setup(b) {
        b.onLoad({ filter: /\.astro$/ }, async ({ path }) => {
          const compiled = await transform(readFileSync(path, "utf8"), {
            filename: relative(root, path),
            sourcemap: "external",
            internalURL: "astro/compiler-runtime",
            resultScopedSlot: true,
            // Ignore formatting indentation; intentional inline spaces are explicit in the templates.
            compact: "jsx",
            resolvePath: (specifier) => specifier,
          });
          return {
            contents: compiled.code,
            loader: "js",
            resolveDir: resolve(path, ".."),
          };
        });
      },
    },
  ],
});
