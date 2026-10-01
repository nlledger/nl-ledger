import { init } from "satori/standalone";
import yoga from "satori/yoga.wasm";
import { initWasm } from "@resvg/resvg-wasm";
import resvg from "@resvg/resvg-wasm/index_bg.wasm";
import font from "../static/fonts/archivo-card.ttf";
import { renderCard } from "./card-render.mjs";
let ready;
let fontBytes;
export async function render(c, assets, origin) {
  await (ready ??= Promise.all([init(yoga), initWasm(resvg)]));
  // Vite emits fonts as immutable asset URLs; direct Wrangler builds import their bytes.
  fontBytes ??=
    typeof font === "string"
      ? assets
          .fetch(new URL(font, origin))
          .then(async (response) => {
            if (!response.ok)
              throw new Error("Share-card font asset unavailable");
            return response.arrayBuffer();
          })
          .catch((error) => {
            fontBytes = undefined;
            throw error;
          })
      : Promise.resolve(font);
  return renderCard(c, await fontBytes);
}
