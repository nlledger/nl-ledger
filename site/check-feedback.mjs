import { parse } from "parse5";
// Checks on the feedback box's endpoint (routes/feedback.js) with stand-ins for D1, the mail binding, the rate
// limit and Turnstile. Runs in CI with no account: `node site/check-feedback.mjs`.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "./worker.mjs";
import { layout, feedbackForm, FEEDBACK_MAX } from "./lib/html.mjs";
import { addressOf } from "./routes/feedback.js";

const HERE = new URL(".", import.meta.url).pathname;
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(HERE + "feedback.sql", "utf8"));
const DB = {
  prepare(text) {
    const st = sql.prepare(text);
    const run = (args) => ({
      all: async () => ({ results: st.all(...args) }),
      first: async () => st.get(...args) ?? null,
      run: async () => (st.run(...args), { success: true }),
    });
    return { ...run([]), bind: (...args) => run(args) };
  },
};
const mails = [];
let mailFails = false;
let allow = true; // the rate limit's answer
let human = true; // Turnstile's answer
const pending = [];
const DATA = {
  "/data/stats.json": {},
  "/data/flags.json": { flags: [], caveat: "" },
  "/data/version.json": { v: "t", updated: "2026-01-01" },
  "/data/links.json": {},
};
const env = {
  DB,
  TURNSTILE_SECRET: "test-secret",
  FEEDBACK_TO: "inbox@example.org",
  MAIL: {
    send: async (m) => {
      if (mailFails)
        throw Object.assign(new Error("no route"), { code: "E_TEST" });
      mails.push(m);
      return { messageId: "m1" };
    },
  },
  FEEDBACK_LIMIT: { limit: async () => ({ success: allow }) },
  ASSETS: {
    fetch: async (u) => Response.json(DATA[new URL(u.url || u).pathname] ?? {}),
  },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) =>
  String(u).includes("siteverify")
    ? Response.json({ success: human && init.body.get("response") === "good" })
    : realFetch(u, init);

const post = async (fields, headers = {}, e = env) => {
  const res = await worker.fetch(
    new Request("https://nlledger.ca/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(fields),
    }),
    e,
    { waitUntil: (p) => pending.push(p) },
  );
  await Promise.all(pending.splice(0));
  return res;
};
const JSON_ = { accept: "application/json" };
const rows = () => sql.prepare("SELECT * FROM feedback ORDER BY id").all();

const findNode = (node, predicate) =>
  predicate(node)
    ? node
    : node.childNodes?.map((child) => findNode(child, predicate)).find(Boolean);
const nodeText = (node) =>
  node?.nodeName === "#text"
    ? node.value
    : (node?.childNodes || []).map(nodeText).join("");
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

// ---- the box is on every page, and posts to the endpoint
{
  const h = await layout({ title: "T", body: "<p>x</p>", path: "/flags/" });
  check(
    /name="kind" value(?:="")? checked/.test(await feedbackForm()),
    "no category is the native default",
  );
  check(
    /name="kind" value="wrong" checked/.test(
      await feedbackForm({ kind: "wrong" }),
    ) &&
      !/name="kind" value(?:="")? checked/.test(
        await feedbackForm({ kind: "wrong" }),
      ),
    "a returned category keeps its selection and can be cleared",
  );
  check(
    /<section class="fb" id="feedback"/.test(h) &&
      /action="\/feedback" method="post"/.test(h),
    "every page carries the box",
  );
  check(
    /name="page" value="\/flags\/"/.test(h),
    "the page's address travels with the note",
  );
  check(/href="#feedback"/.test(h), "the top bar links to the box");
  check(
    !/id="feedback"/.test(
      await layout({ title: "T", body: "", feedback: false }),
    ),
    "a page can leave the box out",
  );
}

// ---- with the Turnstile check passed: stored, emailed, JSON answer
{
  const res = await post(
    {
      kind: "idea",
      note: "  Show budget against actual.\r\nPlease.  ",
      email: "reader@example.ca",
      page: "/priorities/",
      "cf-turnstile-response": "good",
    },
    JSON_,
  );
  const r = rows()[0];
  check(
    res.status === 200 && (await res.json()).ok === true,
    "a checked note is accepted",
  );
  check(
    r &&
      r.kind === "idea" &&
      r.note === "Show budget against actual.\nPlease." &&
      r.email === "reader@example.ca" &&
      r.page === "/priorities/" &&
      r.checked === "turnstile",
    "it is stored as sent, trimmed",
  );
  check(
    r.mail === "sent m1" && mails.length === 1,
    "it is emailed, and the row says so",
  );
  const m = mails[0];
  check(
    m.to === "inbox@example.org" &&
      m.from === "feedback@nlledger.ca" &&
      m.replyTo === "reader@example.ca",
    "the email goes to the address in FEEDBACK_TO, with the visitor's as reply-to",
  );
  check(
    /I have an idea: \/priorities\/$/.test(m.subject) &&
      m.text.includes("Show budget against actual.") &&
      m.text.includes("https://nlledger.ca/priorities/"),
    "the email carries the kind, the page and the note",
  );
  check(
    res.headers.get("cache-control") === "private, no-store",
    "the answer is never cached",
  );
  check(
    !Object.keys(r).some((k) => /ip|agent/i.test(k)),
    "no network address or browser detail is stored",
  );
}

// ---- a subject line cannot be bent by the page field
{
  await post(
    {
      note: "x",
      page: "/a\r\nBcc: someone@example.com",
      "cf-turnstile-response": "good",
    },
    JSON_,
  );
  check(
    !/[\r\n]/.test(mails.at(-1).subject) &&
      rows().at(-1).page === "/aBcc: someone@example.com",
    "line breaks are stripped from the page address",
  );
  await post(
    {
      note: "x",
      page: "https://evil.example/",
      "cf-turnstile-response": "good",
    },
    JSON_,
  );
  check(
    rows().at(-1).page === "",
    "an address on another site is not kept as the page",
  );
}

// ---- without Turnstile: the check page, then one more press
{
  const before = rows().length;
  const f = {
    kind: "wrong",
    note: "A <b>figure</b> looks off",
    email: "",
    page: "/item/abc/",
  };
  let res = await post(f);
  let h = await res.text();
  check(
    res.status === 200 &&
      /Check your note, then send it/.test(h) &&
      rows().length === before,
    "no check: the note is shown back, nothing stored",
  );
  const quote = findNode(
    parse(h),
    (node) =>
      node.tagName === "dd" &&
      node.attrs.some(
        (attr) => attr.name === "class" && attr.value === "fb-quote",
      ),
  );
  check(
    nodeText(quote) === "A <b>figure</b> looks off" &&
      !findNode(parse(h), (node) => node.tagName === "b"),
    "the note is escaped when shown back",
  );
  check(
    res.headers.get("cache-control") === "private, no-store" &&
      !/id="feedback"/.test(h.split("<footer")[1] || ""),
    "the check page is never cached",
  );
  const token = h.match(/name="confirm" value="([^"]+)"/)[1];
  res = await post({ ...f, confirm: token });
  h = await res.text();
  check(
    /That was quick/.test(h) && rows().length === before,
    "a press within two seconds is asked again",
  );
  check(
    h.includes(`name="confirm" value="${token}"`),
    "and keeps its token, so the wait does not start over",
  );
  const old = Date.now;
  Date.now = () => old() + 5000;
  res = await post({ ...f, note: "Something else entirely", confirm: token });
  check(
    /Check your note/.test(await res.text()) && rows().length === before,
    "a token does not carry over to a different note",
  );
  res = await post({
    ...f,
    confirm: token.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
  });
  check(
    /Check your note/.test(await res.text()) && rows().length === before,
    "a forged token is refused",
  );
  res = await post({ ...f, confirm: token });
  check(
    res.status === 303 &&
      res.headers.get("location") === "/feedback/sent/?from=%2Fitem%2Fabc%2F" &&
      rows().length === before + 1 &&
      rows().at(-1).checked === "confirm",
    "after the wait the note is stored, and the browser is sent to the thank-you",
  );
  res = await post(
    { ...f, confirm: token },
    { "cf-connecting-ip": "198.51.100.7" },
  );
  res = await post(
    { ...f, confirm: token },
    { "cf-connecting-ip": "198.51.100.7" },
  );
  check(
    res.status === 303 && rows().length === before + 1,
    "the same token stores once",
  );
  check(
    sql.prepare("SELECT count(*) n FROM feedback_seen").get().n === 0,
    "and a repeated press is not counted against the address",
  );
  Date.now = () => old() + 31 * 60_000;
  res = await post({ ...f, confirm: token });
  check(
    /Check your note/.test(await res.text()),
    "a token over half an hour old is refused",
  );
  Date.now = old;
  res = await post({ ...f, edit: "1" });
  h = await res.text();
  check(
    /Change your note/.test(h) && /<textarea[^>]*>A &lt;b&gt;figure/.test(h),
    "Change it hands the note back in the form",
  );
}

// ---- refusals
{
  const before = rows().length;
  const mailsBefore = mails.length;
  let res = await post({ note: "bot", "cf-turnstile-response": "bad" }, JSON_);
  check(
    res.status === 403 && (await res.json()).fallback === true,
    "a failed Turnstile check is refused",
  );
  res = await post({ note: "   ", "cf-turnstile-response": "good" }, JSON_);
  check(
    res.status === 400 && (await res.json()).field === "note",
    "an empty note is refused",
  );
  res = await post(
    { note: "x".repeat(FEEDBACK_MAX + 1), "cf-turnstile-response": "good" },
    JSON_,
  );
  check(
    res.status === 400,
    `a note over ${FEEDBACK_MAX} characters is refused`,
  );
  res = await post(
    { note: "x".repeat(50000), "cf-turnstile-response": "good" },
    JSON_,
  );
  check(
    res.status === 413,
    "an oversized request is refused before it is read",
  );
  res = await worker.fetch(
    new Request("https://nlledger.ca/feedback", {
      method: "POST",
      body: (() => {
        const d = new FormData();
        d.set("note", "x");
        return d;
      })(),
    }),
    env,
    { waitUntil() {} },
  );
  check(res.status === 415, "a multipart post is refused with a reason");
  for (const bad of ["a\u001bcb@x.ca", "a\u202eb@x.ca", "a\u0000@x.ca"]) {
    res = await post(
      { note: "x", email: bad, "cf-turnstile-response": "good" },
      JSON_,
    );
    if (res.status !== 400)
      check(
        false,
        `an email address with a control character is refused (${JSON.stringify(bad)})`,
      );
  }
  check(
    true,
    "email addresses with control or direction characters are refused",
  );
  res = await post(
    { note: "x", "cf-turnstile-response": "good" },
    { ...JSON_, "sec-fetch-site": "cross-site" },
  );
  check(
    res.status === 403,
    "a cross-site post with no Origin header is refused",
  );
  res = await post({ note: "x" }, { referer: "https://evil.example/page" });
  check(
    res.status === 403 && !/Check your note/.test(await res.text()),
    "so is one that only names another site as its referer",
  );
  res = await post(
    { note: "x", email: "not an address", "cf-turnstile-response": "good" },
    JSON_,
  );
  check(
    res.status === 400 && (await res.json()).field === "email",
    "a bad email address is refused",
  );
  res = await post(
    {
      note: "x",
      email: "a@b.ca\r\nBcc: x@y.z",
      "cf-turnstile-response": "good",
    },
    JSON_,
  );
  check(res.status === 400, "an email address with a line break is refused");
  res = await post(
    { note: "x", "cf-turnstile-response": "good" },
    { ...JSON_, origin: "https://evil.example" },
  );
  check(res.status === 403, "a post from another site is refused");
  res = await post(
    {
      note: "buy pills",
      hp_leave_empty: "http://spam.example",
      "cf-turnstile-response": "good",
    },
    JSON_,
  );
  check(
    res.status === 403 &&
      (await res.json()).fallback === true &&
      rows().length === before,
    "a filled trap field is not taken on Turnstile's word",
  );
  res = await post({
    note: "autofilled by mistake",
    hp_leave_empty: "Main St",
    "cf-turnstile-response": "good",
  });
  check(
    /Check your note/.test(await res.text()) && rows().length === before,
    "it goes to the check page, so a person whose browser filled it loses nothing",
  );
  allow = false;
  res = await post({ note: "x", "cf-turnstile-response": "good" }, JSON_);
  check(
    res.status === 429 && res.headers.get("retry-after") === "60",
    "over the rate limit: refused, with when to try again",
  );
  res = await post({ note: "my only copy" });
  const limitedPage = await res.text();
  check(
    res.status === 429 &&
      /Too many notes/.test(limitedPage) &&
      />my only copy<\/textarea>/.test(limitedPage),
    "the refusal is a page that hands the note back",
  );
  allow = true;
  res = await worker.fetch(
    new Request("https://nlledger.ca/feedback", { method: "DELETE" }),
    env,
    { waitUntil() {} },
  );
  check(res.status === 405, "other methods are refused");
  res = await post({ note: "x", "cf-turnstile-response": "good" }, JSON_, {
    ...env,
    TURNSTILE_SECRET: undefined,
  });
  check(res.status === 503, "with no secret set, nothing is accepted");
  check(
    rows().length === before && mails.length === mailsBefore,
    "none of the refusals stored or emailed anything",
  );
}

// ---- a note a visitor sent with a bad field comes back to them, and only to them
{
  const res = await post({
    note: "keep this text",
    email: "nope",
    kind: "question",
  });
  const h = await res.text();
  check(
    res.status === 400 &&
      /role="alert"/.test(h) &&
      />keep this text<\/textarea>/.test(h) &&
      /value="question" checked/.test(h),
    "a refused note comes back in the form with what is wrong",
  );
  const get = await worker.fetch(
    new Request("https://nlledger.ca/feedback/"),
    env,
    { waitUntil() {} },
  );
  check(
    get.status === 200 && !(await get.text()).includes("keep this text"),
    "the form page shows nothing anyone sent",
  );
}

// ---- mail failing does not lose the note
{
  mailFails = true;
  const res = await post(
    { note: "mail is down", "cf-turnstile-response": "good" },
    JSON_,
  );
  check(
    res.status === 200 &&
      rows().at(-1).note === "mail is down" &&
      /^failed: E_TEST/.test(rows().at(-1).mail),
    "a mail failure keeps the note and records the failure",
  );
  mailFails = false;
}

// ---- a long note in another script
{
  const n = rows().length;
  const res = await post(
    { note: "ᐃᓄᒃᑎᑐᑦ".repeat(285), "cf-turnstile-response": "good" },
    JSON_,
  );
  check(
    res.status === 200 && rows().length === n + 1,
    "1,995 Inuktitut characters are accepted (every one is nine bytes on the wire)",
  );
}

// ---- one address, one day
{
  const from = (ip) => ({ ...JSON_, "cf-connecting-ip": ip });
  const n = rows().length;
  let last;
  for (let i = 0; i < 11; i++)
    last = await post(
      { note: `note ${i}`, "cf-turnstile-response": "good" },
      from("203.0.113.9"),
    );
  check(
    last.status === 429 && rows().length === n + 10,
    "one address stores ten notes in a day, and the eleventh is refused",
  );
  const other = await post(
    { note: "someone else", "cf-turnstile-response": "good" },
    from("203.0.113.10"),
  );
  check(other.status === 200, "another address is not affected");
  await post(
    { note: "v6 a", "cf-turnstile-response": "good" },
    from("2001:db8:1:2:aaaa::1"),
  );
  await post(
    { note: "v6 b", "cf-turnstile-response": "good" },
    from("2001:db8:1:2:bbbb::2"),
  );
  const seen = sql.prepare("SELECT k, n FROM feedback_seen ORDER BY n").all();
  check(
    seen.length === 3 && seen.at(-2).n === 2,
    "an IPv6 /64 counts as one address",
  );
  check(
    addressOf("2001:db8::1:2:3:4") === addressOf("2001:db8::9:2:3:4") &&
      addressOf("2001:0db8:0:0:1::") === "2001:db8:0:0" &&
      addressOf("::1") === "0:0:0:0" &&
      addressOf("203.0.113.9") === "203.0.113.9",
    "a shortened IPv6 address is expanded before its /64 is taken",
  );
  sql
    .prepare(
      "INSERT INTO feedback_seen (k, day, n) VALUES ('old', '2020-01-01', 1), ('yesterday', ?, 1)",
    )
    .run(new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  await post(
    { note: "again", "cf-turnstile-response": "good" },
    from("203.0.113.10"),
  );
  const kept = sql
    .prepare("SELECT k FROM feedback_seen")
    .all()
    .map((r) => r.k);
  check(
    !kept.includes("old") && kept.includes("yesterday"),
    "counts more than a day old are deleted whenever a note arrives",
  );
  check(
    seen.every((r) => !/203|2001|db8/.test(r.k)) &&
      !JSON.stringify(rows()).includes("203.0.113"),
    "no address is stored, only a one-way code, apart from the notes",
  );
}

// ---- the check page's share of the day
{
  const old = Date.now;
  const viaCheckPage = async (note) => {
    const f = { note };
    const h = await (await post(f)).text();
    const token = h.match(/name="confirm" value="([^"]+)"/)[1];
    Date.now = () => old() + 3000;
    const res = await post({ ...f, confirm: token });
    Date.now = old;
    return res;
  };
  const ins = sql.prepare(
    "INSERT INTO feedback (created, note, checked, nonce) VALUES (?, 'fill', 'confirm', ?)",
  );
  const have = sql
    .prepare("SELECT count(*) n FROM feedback WHERE checked = 'confirm'")
    .get().n;
  for (let i = have; i < 60; i++)
    ins.run(new Date().toISOString(), `cfill-${i}`);
  const n = rows().length;
  let res = await viaCheckPage("the sixty-first by the check page");
  check(
    res.status === 503 && rows().length === n,
    "the check page stores 60 notes a day, then no more",
  );
  res = await post(
    {
      note: "a Turnstile-checked note still gets in",
      "cf-turnstile-response": "good",
    },
    JSON_,
  );
  check(
    res.status === 200 && rows().length === n + 1,
    "which leaves the rest of the day's room for Turnstile-checked notes",
  );
}

// ---- the day's cap
{
  const ins = sql.prepare(
    "INSERT INTO feedback (created, note, checked, nonce) VALUES (?, 'fill', 'test', ?)",
  );
  for (let i = 0; i < 300; i++) ins.run(new Date().toISOString(), `fill-${i}`);
  const n = rows().length;
  const res = await post(
    { note: "one too many", "cf-turnstile-response": "good" },
    JSON_,
  );
  check(
    res.status === 503 && rows().length === n,
    "past 300 notes in a day, no more are stored",
  );
}

// ---- the thank-you
{
  const get = (u) =>
    worker
      .fetch(new Request("https://nlledger.ca" + u), env, { waitUntil() {} })
      .then((r) => r.text());
  check(
    /href="\/flags\/">\s*Back\s+to\s+the\s+page\s+you\s+were\s+on/.test(
      await get("/feedback/sent/?from=/flags/"),
    ),
    "the thank-you links back to the page",
  );
  check(
    !/evil/.test(await get("/feedback/sent/?from=//evil.example/")) &&
      !/evil/.test(await get("/feedback/sent/?from=https://evil.example/")) &&
      !/evil/.test(await get("/feedback/sent/?from=/%5Cevil.example/x")),
    "and never to another site, by slash or backslash",
  );
}

// ---- receipt context never stores or emails an income
{
  sql.exec("DELETE FROM feedback; DELETE FROM feedback_seen");
  const pages = [
    "/receipt/?income=55001",
    "/receipt?income=55002&income=55003",
    "/receipt/sub/?%69ncome=55004",
    "/%72eceipt/?income=55005",
  ];
  for (const page of pages) {
    await post(
      { note: "dummy privacy check", page, "cf-turnstile-response": "good" },
      JSON_,
    );
    check(
      !/5500[1-5]|income/i.test(rows().at(-1).page),
      "receipt page context drops income before storage",
    );
    check(
      !/5500[1-5]|income/i.test(mails.at(-1).text + mails.at(-1).subject),
      "receipt page context drops income before mail",
    );
  }
  await post(
    { note: "dummy referrer check", "cf-turnstile-response": "good" },
    { ...JSON_, referer: "https://nlledger.ca/receipt/?income=55006" },
  );
  check(
    !/55006|income/.test(rows().at(-1).page),
    "receipt referer fallback drops income",
  );
}

// ---- simultaneous requests cannot take the last slot twice
for (const mode of ["total", "confirm"]) {
  sql.exec("DELETE FROM feedback; DELETE FROM feedback_seen");
  const fill = sql.prepare(
    "INSERT INTO feedback (created, note, checked, nonce) VALUES (?, 'dummy', ?, ?)",
  );
  const cap = mode === "total" ? 300 : 60;
  for (let i = 0; i < cap - 1; i++)
    fill.run(
      new Date().toISOString(),
      mode === "confirm" ? "confirm" : "turnstile",
      `boundary-${i}`,
    );
  const fields = [];
  for (let i = 0; i < 2; i++) {
    const f = { note: `dummy concurrent ${i}`, page: "/flags/" };
    if (mode === "confirm") {
      const h = await (await post(f)).text();
      f.confirm = h.match(/name="confirm" value="([^"]+)"/)[1];
    } else f["cf-turnstile-response"] = "good";
    fields.push(f);
  }
  const old = Date.now;
  const beforeMail = mails.length;
  try {
    Date.now = () => old() + 5000;
    const responses = await Promise.all(
      fields.map((f, i) =>
        post(f, { ...JSON_, "cf-connecting-ip": `198.51.100.${100 + i}` }),
      ),
    );
    await Promise.all(pending.splice(0));
    check(
      responses
        .map((r) => r.status)
        .sort()
        .join() === "200,503" && rows().length === cap,
      `concurrent distinct addresses respect the ${mode} cap`,
    );
    check(
      mails.length === beforeMail + 1,
      `only one ${mode} boundary note is emailed`,
    );
    if (mode === "confirm") {
      const accepted = fields[responses.findIndex((r) => r.status === 200)];
      const replay = await post(accepted, JSON_);
      check(
        replay.status === 200 &&
          rows().length === cap &&
          mails.length === beforeMail + 1,
        "nonce replay at full capacity remains successful without another mail",
      );
    }
  } finally {
    Date.now = old;
  }
}

console.log(failed ? `${failed} FAILED` : "feedback checks: pass");
process.exit(failed ? 1 : 0);
