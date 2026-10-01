// cf detects Astro and invokes `astro build`. Keep data, guardrails and Worker packaging in that build.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../", import.meta.url));
export function ledgerBuild() {
  return {
    name: "nl-ledger-build",
    hooks: {
      "astro:config:setup": ({ command }) => {
        if (command !== "build") return;
        execFileSync(process.execPath, ["build.mjs"], {
          cwd,
          stdio: "inherit",
        });
        execFileSync("./check.sh", [], { cwd, stdio: "inherit" });
      },
      "astro:build:done": () => {
        // The adapter has built the Worker and assets. cf-wrangler writes the Build Output Specification.
        execFileSync("./node_modules/.bin/cf-wrangler", ["build"], {
          cwd,
          stdio: "inherit",
          env: { ...process.env, NL_LEDGER_ASTRO_BUILT: "1" },
        });
      },
    },
  };
}
