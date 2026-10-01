import { SECURITY_HEADERS } from "./headers.mjs";

// An uncaught throw becomes a plain 500 here. Left alone, Astro renders its /500 route,
// which the catch-all page also matches, so the handler would run again (three times in all).
export async function guarded(handler, request) {
  try {
    return await handler();
  } catch (error) {
    console.error("Unhandled error", request.method, new URL(request.url).pathname, error);
    return new Response("Something went wrong. Please try again shortly.\n", {
      status: 500,
      headers: {
        ...SECURITY_HEADERS,
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}
