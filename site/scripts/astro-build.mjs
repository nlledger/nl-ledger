// cf detects Astro and invokes `astro build`. Keep data, guardrails and Worker packaging in that build.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
const cwd = fileURLToPath(new URL("../", import.meta.url));
function run(cmd, args) {
  try {
    execFileSync(cmd, args, { cwd, stdio: "inherit" });
  } catch (e) {
    if (e.signal === "SIGKILL")
      throw new Error(`${args[0] ?? cmd} was killed, most likely out of memory`);
    throw e;
  }
}

export function ledgerBuild() {
  return {
    name: "nl-ledger-build",
    hooks: {
      "astro:config:setup": ({ command }) => {
        if (command !== "build") return;
        // The weekly job has already run build.mjs and check.sh on its own. Running build.mjs
        // again under astro and cf needs more memory than the job's container has.
        if (process.env.NL_LEDGER_DIST_BUILT === "1") {
          if (!existsSync(`${cwd}dist/index.html`))
            throw new Error("NL_LEDGER_DIST_BUILT=1 but dist/index.html is missing");
          return;
        }
        run(process.execPath, ["build.mjs"]);
        run("./check.sh", []);
      },
      "astro:build:done": () => {
        // Vite discovers public files before config:setup builds dist. Copy the
        // completed data build explicitly, including our _headers. The adapter
        // sees the explicit /_astro policy and leaves it intact.
        cpSync(`${cwd}dist`, `${cwd}.astro-build/client`, { recursive: true });
        execFileSync(
          process.execPath,
          ["check-astro-edges.mjs", "--built-assets"],
          {
            cwd,
            stdio: "inherit",
          },
        );
        // The adapter has built the Worker and assets. cf-wrangler writes the Build Output Specification.
        execFileSync("./node_modules/.bin/cf-wrangler", ["build"], {
          cwd,
          stdio: "inherit",
          env: { ...process.env, NL_LEDGER_ASTRO_BUILT: "1" },
        });
        // Plain Wrangler must never select last build's deployment settings.
        // cf packages via wrangler.config.ts and does not use this redirect.
        mkdirSync(`${cwd}.wrangler/deploy`, { recursive: true });
        writeFileSync(
          `${cwd}.wrangler/deploy/config.json`,
          JSON.stringify({
            configPath: "../../wrangler.jsonc",
          }),
        );
      },
    },
  };
}
