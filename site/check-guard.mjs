// An uncaught Worker error returns one 500 with the security headers and no caching.
import assert from "node:assert/strict";
import { guarded } from "./lib/guard.mjs";
import { SECURITY_HEADERS } from "./lib/headers.mjs";

const request = new Request("https://nlledger.ca/item/abcdef123456/");
const log = console.error;
console.error = () => {};
let calls = 0;
const res = await guarded(async () => {
  calls++;
  throw new Error("D1 is down");
}, request);
console.error = log;
assert.equal(calls, 1, "handler runs once");
assert.equal(res.status, 500);
assert.equal(res.headers.get("cache-control"), "no-store");
for (const [name, value] of Object.entries(SECURITY_HEADERS))
  assert.equal(res.headers.get(name), value, name);
assert.match(await res.text(), /Something went wrong/);
const ok = new Response("fine", { status: 201 });
assert.equal(await guarded(async () => ok, request), ok, "responses pass through");
console.log("guard: errors become one 500 with security headers; responses untouched");
