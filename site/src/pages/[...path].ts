import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import worker from "../../worker.mjs";

// Keep the existing dispatcher, method handling, cache keys and security headers.
export const ALL: APIRoute = ({ request, locals }) =>
  worker.fetch(request, env, locals.cfContext);
