import { handle } from "@astrojs/cloudflare/handler";
import { protectEntry } from "./lib/entry-guard.mjs";

export default { fetch: protectEntry(handle) };
