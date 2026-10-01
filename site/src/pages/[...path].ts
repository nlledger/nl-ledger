import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import worker from "../../worker.mjs";
import { guarded } from "../../lib/guard.mjs";

// Keep the existing dispatcher, method handling, cache keys and security headers.
export const ALL: APIRoute = ({ request, locals }) =>
  guarded(() => worker.fetch(request, env, locals.cfContext), request);
