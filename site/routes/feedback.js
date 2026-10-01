import {
  components_FeedbackPage_astro as FeedbackPage,
  components_FeedbackConfirmation_astro as FeedbackConfirmation,
  components_FeedbackSent_astro as FeedbackSent,
} from "../.render/components.mjs";
import { renderAstro } from "../lib/render.mjs";
import { feedbackContext } from "../lib/privacy.mjs";
// The feedback box's endpoint (NOTES.md "Feedback box"). POST /feedback stores a visitor's note in the
// D1 table `feedback` and emails it; GET /feedback/ is the form on a page of its own; /feedback/sent/ is the thank-you.
// A note is only ever shown back to the person who typed it, in a response marked no-store.
import { FEEDBACK_KINDS, FEEDBACK_MAX } from "../lib/html.mjs";
import { SITE } from "../lib/format.mjs";
import { assets, page } from "./_shared.js";
const KINDS = Object.fromEntries(FEEDBACK_KINDS);
const FROM = "feedback@nlledger.ca"; // any address on the domain: Email Routing is on for it
const BODY_MAX = 40_000; // bytes of form data: 2,000 characters outside the Latin alphabet are up to 24,000 once encoded
const DAY_CAP = 300; // notes stored in 24 hours, all visitors together: a flood cannot fill the table or the mailbox
const CONFIRM_DAY_CAP = 60; // of those, notes that came through the check page: a script can walk that page, so it gets less room
const ADDRESS_DAY_CAP = 10; // notes stored in a day from one network address, so one sender cannot use up the day's room
const CONFIRM_MIN = 2_000; // ms between being shown the check page and pressing Send
const CONFIRM_MAX = 30 * 60_000;
const EMAIL =
  /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const UNSEEN =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/; // control and direction characters
const OTHER_WAY = `Email ${SITE.contact} instead.`;

// ---- what a visitor sent, cleaned
const clip = (s, n) => [...s].slice(0, n).join("");
// A path on this site (never another site's address), or nothing.
export function cleanPage(p) {
  const s = String(p ?? "").replace(/[\u0000-\u001f\u007f]/g, "");
  // One leading slash and no backslash anywhere: browsers read "/\\host" as another site.
  return /^\/(?!\/)/.test(s) && !s.includes("\\")
    ? clip(feedbackContext(s), 300)
    : "";
}
function read(form, request) {
  const get = (k) => String(form.get(k) ?? "");
  let at = cleanPage(get("page"));
  if (!at) {
    // No page field (a hand-made form post): the page the browser says it came from, if it is this site.
    try {
      const ref = new URL(request.headers.get("referer") || "");
      if (ref.host === new URL(request.url).host)
        at = cleanPage(ref.pathname + ref.search);
    } catch {}
  }
  return {
    kind: KINDS[get("kind")] ? get("kind") : "",
    note: get("note")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .trim(),
    email: get("email").trim(),
    trap: get("hp_leave_empty") !== "",
    page: at,
  };
}
function problem(f) {
  if (!f.note)
    return {
      field: "note",
      error:
        "The note is empty. Write what is missing, wrong or confusing, then press Send.",
    };
  if ([...f.note].length > FEEDBACK_MAX)
    return {
      field: "note",
      error: `The note is over ${FEEDBACK_MAX.toLocaleString("en-CA")} characters. Shorten it, or send it in two parts.`,
    };
  if (
    f.email &&
    (f.email.length > 254 || !EMAIL.test(f.email) || UNSEEN.test(f.email))
  )
    return {
      field: "email",
      error:
        "That email address does not look right. Correct it, or leave it empty.",
    };
  return null;
}

// ---- the check that a person is sending it
// With JavaScript: Cloudflare Turnstile, loaded only once someone starts a note (static/app.js).
// Without it, or when Turnstile cannot run: a second page shows the note back and asks for one more press.
// That page carries a token signed with the Worker's secret over the note and the time, so a note cannot be
// stored without first asking for the page, waiting, and sending the same note back; each token stores once.
const b64 = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const bytes = (s) => new TextEncoder().encode(s);
async function sign(secret, f, ts) {
  const digest = b64(
    await crypto.subtle.digest(
      "SHA-256",
      bytes(JSON.stringify([f.kind, f.note, f.email, f.page])),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  return b64(
    await crypto.subtle.sign(
      "HMAC",
      key,
      bytes(`nl-ledger feedback confirm v1\n${ts}\n${digest}`),
    ),
  );
}
const confirmToken = async (secret, f, now) =>
  `${now}.${await sign(secret, f, now)}`;
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// "ok", "early" (pressed within two seconds), or "bad" (forged, changed note, or older than half an hour).
async function checkConfirm(secret, token, f, now) {
  const [ts, sig] = String(token).split(".");
  if (!/^\d{13}$/.test(ts || "") || !sig)
    return {
      state: "bad",
    };
  if (!same(sig, await sign(secret, f, Number(ts))))
    return {
      state: "bad",
    };
  const age = now - Number(ts);
  if (age > CONFIRM_MAX || age < 0)
    return {
      state: "bad",
    };
  return {
    state: age < CONFIRM_MIN ? "early" : "ok",
    nonce: sig,
  };
}
// One network address, for the limits: an IPv6 home or phone holds a whole /64, so its first four groups.
export function addressOf(ip) {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t]
    : h;
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, "").toLowerCase())
    .join(":");
}
// The day's count for an address is kept under a keyed one-way code of it, in a table of its own
// (feedback_seen): no address is stored, nothing there points at a note, and counts over a day old are deleted when a note arrives.
async function addressCode(secret, ip, day) {
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  return b64(
    await crypto.subtle.sign(
      "HMAC",
      key,
      bytes(`nl-ledger feedback address v1\n${day}\n${addressOf(ip)}`),
    ),
  ).slice(0, 22);
}
async function turnstile(env, token, ip) {
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
          ...(ip
            ? {
                remoteip: ip,
              }
            : {}),
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    return (await res.json()).success === true;
  } catch {
    return false; // Turnstile unreachable: the check page takes over
  }
}

// ---- pages
const noStore = (res) => (
  res.headers.set("cache-control", "private, no-store"),
  res
);
async function render(ctx, { title, body, status = 200 }) {
  const a = await assets(ctx);
  return noStore(
    await page(ctx, a, {
      title,
      description:
        "Send a note about anything on NL Ledger that is missing, wrong or confusing. No account is needed.",
      body,
      status,
      path: "/feedback/",
      robots: "noindex",
      feedback: false,
    }),
  );
}
const formPage = async (ctx, f, { title, lede, error, field, status }) =>
  await render(ctx, {
    title,
    status,
    body: await renderAstro(FeedbackPage, {
      title,
      lede,
      form: {
        ...f,
        error,
        field,
      },
    }),
  });

// `early`: the press came within two seconds. The page keeps the same token, so the wait is not started again.
async function confirmPage(ctx, f, token, early) {
  return await render(ctx, {
    title: "Check your note, then send it",
    body: await renderAstro(FeedbackConfirmation, {
      early,
      f,
      KINDS,
      token,
    }),
  });
}

// GET /feedback/sent/
export const sent = {
  async onRequestGet(ctx) {
    const from = cleanPage(new URL(ctx.request.url).searchParams.get("from"));
    return await render(ctx, {
      title: "Thank you. Your note was sent.",
      body: await renderAstro(FeedbackSent, {
        from,
      }),
    });
  },
};

// ---- storing and sending
async function email(env, row) {
  // The mail binding delivers only to an address verified in Email Routing; FEEDBACK_TO (a Worker secret) holds it.
  if (!env.MAIL || !env.FEEDBACK_TO)
    return `not sent: no ${env.MAIL ? "FEEDBACK_TO secret" : "mail binding"}`;
  const ascii = (s) => s.replace(/[^\x20-\x7e]/g, "?");
  try {
    const r = await env.MAIL.send({
      from: FROM,
      to: env.FEEDBACK_TO,
      ...(row.email
        ? {
            replyTo: row.email,
          }
        : {}),
      subject: ascii(
        `[${SITE.name} feedback #${row.id}] ${KINDS[row.kind] || "Note"}: ${row.page || "no page"}`,
      ).slice(0, 140),
      text: `Kind: ${KINDS[row.kind] || "not chosen"}
Page: ${row.page ? SITE.url + row.page : "not given"}
Reply to: ${row.email || "no email address left"}
Received: ${row.created} (note ${row.id})

${row.note}

--
Sent from the feedback box on ${SITE.url.replace("https://", "")}. Replying to this message writes to the visitor when they left an address.
`,
    });
    return `sent ${r?.messageId || ""}`.trim();
  } catch (e) {
    return `failed: ${e.code || e.name || ""} ${e.message || e}`.slice(0, 300);
  }
}

// D1 serializes writes; capacity is checked inside the same statement as insertion.
export const FEEDBACK_INSERT_QUERY = `INSERT INTO feedback (created, kind, page, note, email, checked, nonce)
SELECT ?, ?, ?, ?, ?, ?, ?
WHERE (SELECT count(*) FROM feedback WHERE created > ?) < ?
  AND (? != 'confirm' OR (SELECT count(*) FROM feedback WHERE created > ? AND checked = 'confirm') < ?)
ON CONFLICT(nonce) DO NOTHING RETURNING id`;
async function store(ctx, f, checked, nonce, ip) {
  const { env } = ctx;
  const now = new Date();
  // The same token sent twice (a double press, a reload): already stored, nothing more to do or to count.
  if (
    await env.DB.prepare("SELECT 1 FROM feedback WHERE nonce = ?")
      .bind(nonce)
      .first()
  )
    return "stored";
  const created = now.toISOString();
  if (ip) {
    const day = created.slice(0, 10);
    const seen = await env.DB.prepare(
      "INSERT INTO feedback_seen (k, day, n) VALUES (?, ?, 1) ON CONFLICT(k, day) DO UPDATE SET n = n + 1 RETURNING n",
    )
      .bind(await addressCode(env.TURNSTILE_SECRET, ip, day), day)
      .first();
    // Only today's and yesterday's counts are kept.
    ctx.waitUntil(
      env.DB.prepare("DELETE FROM feedback_seen WHERE day < ?")
        .bind(new Date(now - 86_400_000).toISOString().slice(0, 10))
        .run()
        .catch(() => {}),
    );
    if (seen.n > ADDRESS_DAY_CAP) return "many";
  }
  const row = await env.DB.prepare(FEEDBACK_INSERT_QUERY)
    .bind(
      created,
      f.kind,
      f.page,
      f.note,
      f.email,
      checked,
      nonce,
      new Date(now - 86_400_000).toISOString(),
      DAY_CAP,
      checked,
      new Date(now - 86_400_000).toISOString(),
      CONFIRM_DAY_CAP,
    )
    .first();
  if (!row)
    return (await env.DB.prepare("SELECT 1 FROM feedback WHERE nonce = ?")
      .bind(nonce)
      .first())
      ? "stored"
      : "full";
  ctx.waitUntil(
    (async () => {
      const mail = await email(env, {
        ...f,
        id: row.id,
        created,
      });
      await env.DB.prepare("UPDATE feedback SET mail = ? WHERE id = ?")
        .bind(mail, row.id)
        .run();
    })().catch((e) => console.error("feedback mail", e)),
  );
  return "stored";
}
export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  if (request.method === "GET" || request.method === "HEAD") {
    return await formPage(
      ctx,
      {
        page: cleanPage(url.searchParams.get("page")),
      },
      {
        title: "Something missing, wrong or confusing?",
        lede: "Say so here. No account is needed, and no email program. Every note is read.",
      },
    );
  }
  if (request.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        allow: "GET, HEAD, POST",
      },
    });
  const json = (request.headers.get("accept") || "").includes(
    "application/json",
  );
  const fail = async (status, error, f = {}, field = "", extra = {}) =>
    json
      ? noStore(
          Response.json(
            {
              ok: false,
              error,
              field,
              ...extra,
            },
            {
              status,
            },
          ),
        )
      : await formPage(ctx, f, {
          title: "Your note was not sent",
          error,
          field,
          status,
        });

  // A form on another site cannot post here.
  // A browser says where a post came from in one of three headers; whichever is present must name this site.
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const referer = request.headers.get("referer");
  const foreign = origin
    ? origin !== url.origin
    : site
      ? site !== "same-origin" && site !== "none"
      : referer
        ? !referer.startsWith(url.origin + "/")
        : false;
  if (foreign) return await fail(403, `This form only works on ${url.host}.`);
  const ip = request.headers.get("cf-connecting-ip") || "";
  const limited = env.FEEDBACK_LIMIT
    ? !(
        await env.FEEDBACK_LIMIT.limit({
          key: addressOf(ip) || "unknown",
        })
      ).success
    : false;
  const tooLong = `That is too long to send. Keep the note under ${FEEDBACK_MAX.toLocaleString("en-CA")} characters.`;
  if (Number(request.headers.get("content-length") || 0) > BODY_MAX)
    return await fail(413, tooLong);
  if (/^multipart\//i.test(request.headers.get("content-type") || ""))
    return await fail(
      415,
      "The note could not be read. Send it from the form on this site.",
    );
  let form;
  try {
    const text = await request.text();
    if (text.length > BODY_MAX) return await fail(413, tooLong);
    form = new URLSearchParams(text);
  } catch {
    return await fail(400, "The note could not be read. Try again.");
  }
  const f = read(form, request);
  if (limited) {
    // The note goes back in the form, so a minute's wait does not cost the visitor what they wrote.
    const res = await fail(
      429,
      `Too many notes from this connection in a short time. Wait a minute and press Send again. ${OTHER_WAY}`,
      f,
    );
    res.headers.set("retry-after", "60");
    return res;
  }
  if (form.get("edit"))
    return await formPage(ctx, f, {
      title: "Change your note",
      lede: "Nothing has been sent yet.",
    });
  const bad = problem(f);
  if (bad) return await fail(400, bad.error, f, bad.field);
  const done = () =>
    json
      ? noStore(
          Response.json({
            ok: true,
          }),
        )
      : noStore(
          new Response(null, {
            status: 303,
            headers: {
              location: `/feedback/sent/?from=${encodeURIComponent(f.page)}`,
            },
          }),
        );
  if (!env.TURNSTILE_SECRET || !env.DB)
    return await fail(503, `Notes cannot be taken right now. ${OTHER_WAY}`, f);
  const checkPage = async (early) =>
    await confirmPage(
      ctx,
      f,
      early || (await confirmToken(env.TURNSTILE_SECRET, f, Date.now())),
      !!early,
    );
  const viaCheckPage = async () =>
    json
      ? await fail(403, "The check did not pass.", f, "", {
          fallback: true,
        })
      : await checkPage();
  let checked = "";
  let nonce = "";
  const token = form.get("cf-turnstile-response");
  const confirm = form.get("confirm");
  // A filled trap field (the one only a script, or an over-eager autofill, fills in) is never taken on Turnstile's
  // word: it goes by the check page, where a person presses once more and a script is held to that page's limits.
  if (token && !f.trap && (await turnstile(env, token, ip))) {
    checked = "turnstile";
    nonce = crypto.randomUUID();
  } else if (confirm) {
    const c = await checkConfirm(env.TURNSTILE_SECRET, confirm, f, Date.now());
    if (c.state === "ok") {
      checked = "confirm";
      nonce = c.nonce;
    } else if (json) return await viaCheckPage();
    else return await checkPage(c.state === "early" ? confirm : "");
  } else {
    // No check yet: the script falls back to a plain form post, and a plain form post gets the check page.
    return await viaCheckPage();
  }
  let result;
  try {
    result = await store(ctx, f, checked, nonce, ip);
  } catch (e) {
    console.error("feedback store", e);
    return await fail(
      503,
      `The note could not be saved just now. Press Send again in a moment. ${OTHER_WAY}`,
      f,
    );
  }
  if (result === "full")
    return await fail(
      503,
      `More notes than usual have come in today, and no more can be taken until tomorrow. ${OTHER_WAY}`,
      f,
    );
  if (result === "many")
    return await fail(
      429,
      `That is the most notes one connection can send in a day. ${OTHER_WAY}`,
      f,
    );
  return done();
}
