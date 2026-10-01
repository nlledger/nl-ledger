// Used by check-mcp-live.mjs --sample. Never reads or writes the checkout's data/.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const text = (value) =>
  assert.ok(
    typeof value === "string" && value.trim().length,
    "Expected non-empty text",
  );
const number = (value) =>
  assert.ok(
    typeof value === "number" && Number.isFinite(value),
    "Expected finite number",
  );
const object = (value) =>
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected object",
  );
const rows = (value) => {
  assert.ok(Array.isArray(value) && value.length, "Expected non-empty array");
  return value;
};
const url = (value) => {
  text(value);
  assert.equal(new URL(value).protocol, "https:");
};
const citation = (value) => {
  assert.match(value.id, /^[a-f0-9]{12}$/);
  text(value.source);
  url(value.source_url);
  url(value.page_url);
  assert.ok(Object.hasOwn(value, "native_amount"));
  text(value.native_currency);
};

const root = mkdtempSync(join(tmpdir(), "nl-ledger-mcp-"));
let child,
  exited,
  startupError,
  output = "";
try {
  // dev.mjs chooses the full ledger when present. A fresh root guarantees the sample
  // even on a maintainer's checkout; copying also permits a safe mutation proof.
  cpSync(import.meta.dirname, join(root, "site"), {
    recursive: true,
    filter: (path) =>
      ![
        "node_modules",
        "dist",
        ".render",
        ".astro",
        ".astro-build",
        ".cloudflare",
        ".wrangler",
      ].includes(basename(path)) && !basename(path).startsWith(".env"),
  });
  cpSync(new URL("../sample", import.meta.url), join(root, "sample"), {
    recursive: true,
  });
  symlinkSync(
    join(import.meta.dirname, "node_modules"),
    join(root, "site/node_modules"),
    "dir",
  );
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  const origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["dev.mjs", String(port)], {
    cwd: join(root, "site"),
    env: { ...process.env, PORT: String(port), NL_LEDGER_MEANING: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  exited = new Promise((resolve) => child.once("close", resolve));
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(-12000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(-12000);
  });
  child.on("error", (error) => {
    startupError = error;
    output += error.message;
  });
  const deadline = Date.now() + 120000;
  while (!output.includes("NL Ledger is running at")) {
    assert.equal(
      startupError,
      undefined,
      `Could not start dev.mjs: ${startupError}`,
    );
    assert.equal(
      child.exitCode,
      null,
      `dev.mjs stopped during startup:\n${output}`,
    );
    assert.equal(
      child.signalCode,
      null,
      `dev.mjs was killed during startup:\n${output}`,
    );
    assert.ok(Date.now() < deadline, `dev.mjs startup timed out:\n${output}`);
    await delay(100);
  }
  assert.match(output, /Using the sample data/);
  let id = 0;
  async function post(body) {
    const response = await fetch(origin + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
      signal: AbortSignal.timeout(10000),
    });
    assert.match(response.headers.get("content-type"), /application\/json/);
    return { status: response.status, data: await response.json() };
  }
  async function rpc(method, params) {
    const requestId = ++id;
    const { status, data } = await post(
      JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    );
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.jsonrpc, "2.0");
    assert.equal(data.id, requestId);
    assert.equal(data.error, undefined, JSON.stringify(data));
    object(data.result);
    return data.result;
  }
  async function tool(name, args = {}, isError = false) {
    const result = await rpc("tools/call", { name, arguments: args });
    assert.equal(result.isError, isError, `${name}: ${JSON.stringify(result)}`);
    object(result.structuredContent);
    const content = rows(result.content);
    assert.equal(content[0].type, "text");
    text(content[0].text);
    assert.deepEqual(JSON.parse(content[0].text), result.structuredContent);
    if (isError) text(result.structuredContent.error);
    return result.structuredContent;
  }
  // Explicit cases must exactly match the HTTP catalog: a new tool cannot silently
  // bypass the smoke test. Use ids returned by real calls for dependent lookups.
  let record, supplier, flag;
  const cases = {
    search_records: async () => {
      const got = await tool("search_records", { source: "ppa" });
      number(got.records_found);
      assert.ok(got.records_found > 0);
      assert.equal(got.page, 1);
      number(got.pages);
      url(got.search_page_url);
      rows(got.records).forEach(citation);
      record = got.records[0];
      supplier = got.records.find((r) => r.supplier_id)?.supplier_id;
      assert.match(supplier, /^[a-f0-9]{10}$/);
    },
    get_record: async () => {
      const got = await tool("get_record", { id: record.id });
      citation(got);
      assert.equal(got.id, record.id);
      assert.equal(got.native_amount, record.native_amount);
    },
    get_supplier: async () => {
      const got = await tool("get_supplier", { supplier_id: supplier });
      assert.equal(got.supplier_id, supplier);
      text(got.name);
      number(got.records);
      assert.ok(got.records > 0);
      object(got.by_source);
      rows(Object.keys(got.by_source));
      object(got.by_year);
      rows(Object.keys(got.by_year));
      rows(got.largest_records).forEach(citation);
      url(got.page_url);
    },
    get_department: async () => {
      const got = await tool("get_department", { name: "Health" });
      text(got.department);
      assert.match(got.fiscal_year, /^\d{4}-\d{2}$/);
      rows(got.columns).forEach(text);
      rows(got.gross).forEach(number);
      rows(got.programs).forEach((p) => {
        text(p.program);
        rows(p.values).forEach(number);
        url(p.source);
      });
      url(got.source_url);
      url(got.page_url);
    },
    get_budget: async () => {
      const got = await tool("get_budget");
      assert.match(got.fiscal_year, /^\d{4}-\d{2}$/);
      rows(got.years);
      object(got.bases);
      object(got.departments_spending);
      object(got.whole_government);
      rows(got.departments).forEach((d) => text(d.department));
      url(got.page_url);
      url(got.method_url);
    },
    get_members: async () => {
      const got = await tool("get_members");
      text(got.source);
      text(got.fiscal_year);
      number(got.members);
      number(got.average_cad);
      const ranking = rows(got.ranking);
      assert.equal(got.members, ranking.length);
      ranking.forEach((r) => {
        text(r.name);
        number(r.amount_cad);
        url(r.page_url);
      });
    },
    list_flags: async () => {
      const got = await tool("list_flags");
      text(got.caveat);
      rows(got.flags).forEach((f) => {
        text(f.id);
        text(f.title);
        object(f.count);
        number(f.count.items);
        number(f.count.subjects);
      });
      flag = got.flags.find(
        (f) => f.count.items > 0 || f.count.subjects > 0,
      )?.id;
      text(flag);
    },
    get_flag: async () => {
      const got = await tool("get_flag", { id: flag });
      assert.equal(got.id, flag);
      text(got.title);
      text(got.caveat);
      object(got.results.count);
      rows([
        ...(got.results.top_items || []),
        ...(got.results.top_subjects || []),
      ]);
      url(got.page_url);
      url(got.method_url);
    },
    human_scale: async () => {
      const got = await tool("human_scale", { amount: 50000000 });
      for (const k of [
        "amount",
        "in_words",
        "per_resident",
        "per_household",
        "time_to_earn_at_median_wage",
        "assumption",
      ])
        text(got[k]);
      for (const k of ["population", "households", "median_full_time_wage"])
        text(got.basis[k]);
    },
    search: async () => {
      const got = await tool("search", { query: record.supplier });
      rows(got.results).forEach((r) => {
        assert.match(r.id, /^[a-f0-9]{12}$/);
        text(r.title);
        url(r.url);
      });
    },
    fetch: async () => {
      const got = await tool("fetch", { id: record.id });
      assert.equal(got.id, record.id);
      text(got.title);
      url(got.url);
      citation(JSON.parse(got.text));
      text(got.metadata.source);
      url(got.metadata.source_url);
    },
    get_pay: async () => {
      const got = await tool("get_pay");
      text(got.caveat);
      rows(got.years);
      rows(got.employers).forEach((e) => {
        text(e.employer);
        rows(e.by_year).forEach((y) => {
          text(y.year);
          text(y.status);
        });
        url(e.page_url);
      });
    },
    get_body: async () => {
      const got = await tool("get_body");
      text(got.caveat);
      rows(got.bodies).forEach((b) => {
        text(b.name);
        assert.match(b.body_id, /^[a-f0-9]{10}$/);
        url(b.page_url);
      });
    },
    tax_receipt: async () => {
      const got = await tool("tax_receipt", { income: 55000 });
      assert.equal(got.employment_income_cad, 55000);
      number(got.estimated_provincial_income_tax_cad);
      assert.ok(got.estimated_provincial_income_tax_cad > 0);
      text(got.spending_fiscal_year);
      object(got.tax_parameters);
      text(got.assumptions);
      url(got.page_url);
      url(got.method_url);
      rows(got.departments).forEach((d) => {
        text(d.name);
        number(d.spending_share);
        number(d.illustrated_tax_share_cad);
        url(d.page_url);
      });
    },
    get_totals: async () => {
      const got = await tool("get_totals", {
        source: "ppa",
        group_by: "supplier",
        limit: 3,
      });
      assert.equal(got.group_by, "supplier");
      assert.equal(got.no_matches, false);
      object(got.filters);
      text(got.caveat);
      rows(got.partitions).forEach((p) => {
        assert.equal(p.source, "ppa");
        text(p.currency);
        rows(p.groups).forEach((g) => {
          text(g.id);
          number(g.records);
          assert.ok(g.records > 0);
          number(g.missing_amounts);
          number(g.zero_amounts);
          if (g.missing_amounts === g.records) assert.equal(g.value, null);
          else number(g.value);
          url(g.records_url);
          url(g.page_url);
        });
      });
    },
  };
  const catalog = rows((await rpc("tools/list")).tools);
  const names = catalog.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(
    names.toSorted(),
    Object.keys(cases).toSorted(),
    "Every advertised tool needs a smoke case",
  );
  for (const t of catalog) {
    text(t.description);
    object(t.inputSchema);
    assert.equal(t.inputSchema.type, "object");
  }
  for (const [name, check] of Object.entries(cases)) {
    try {
      await check();
    } catch (error) {
      throw new Error(`${name} HTTP smoke failed: ${error.message}`, {
        cause: error,
      });
    }
    console.log(`MCP sample HTTP: ${name} pass`);
  }
  const invalid = [
    ["search_records", {}],
    ["search_records", { source: "not-a-source" }],
    ["get_record", { id: "bad-id" }],
    ["get_supplier", { supplier_id: "bad-id" }],
    ["get_department", { name: "no-such-department" }],
    ["get_budget", { year: "1900-01" }],
    ["get_members", { year: "1900-01" }],
    ["get_flag", { id: "no-such-pattern" }],
    ["human_scale", { amount: -1 }],
    ["fetch", { id: "bad-id" }],
    ["get_pay", { year: "2024-25" }],
    ["get_body", { name: "no-such-body" }],
    ["tax_receipt", { income: -1 }],
    ["tax_receipt", { income: "55000" }],
    ["get_totals", { group_by: "invalid" }],
    ["get_totals", { limit: 101 }],
  ];
  for (const [name, args] of invalid) await tool(name, args, true);
  const ping = { jsonrpc: "2.0", id: 999, method: "ping" };
  async function rejected(body, status, code) {
    const got = await post(body);
    assert.equal(got.status, status);
    assert.equal(got.data.jsonrpc, "2.0");
    assert.equal(got.data.error.code, code);
    text(got.data.error.message);
  }
  for (const batch of [[], [ping], [ping, { ...ping, id: 1000 }]])
    await rejected(JSON.stringify(batch), 400, -32600);
  const raw = JSON.stringify(ping);
  await rejected(raw + " ".repeat(65537 - raw.length), 413, -32600);
  // Also cross the body limit without Content-Length (chunked HTTP transfer).
  const bytes = Buffer.from(raw + " ".repeat(65537 - raw.length));
  let offset = 0;
  await rejected(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 16384, bytes.length);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    }),
    413,
    -32600,
  );
  await rejected("{invalid", 400, -32700);
  const unknown = await post(
    JSON.stringify({
      ...ping,
      method: "tools/call",
      params: { name: "not-a-tool", arguments: {} },
    }),
  );
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.error.code, -32602);
  // Rejections must leave ordinary requests working; the exact boundary is accepted.
  const boundary = await post(raw + " ".repeat(65536 - raw.length));
  assert.equal(boundary.status, 200);
  assert.equal(boundary.data.id, ping.id);
  assert.deepEqual(boundary.data.result, {});
  assert.deepEqual(await rpc("ping"), {});
  console.log(
    `MCP sample HTTP: all ${names.length} tools, ${invalid.length} bad arguments, batch/body/parse/unknown-tool rejection and recovery pass`,
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const stopped = await Promise.race([
      exited.then(() => true),
      delay(5000).then(() => false),
    ]);
    if (!stopped) {
      child.kill("SIGKILL");
      await exited;
    }
  }
  if (process.platform === "darwin") {
    const cleaned = spawnSync("/usr/bin/trash", [root]);
    assert.equal(
      cleaned.status,
      0,
      `Could not move temporary sample checkout to Trash: ${root}`,
    );
  } else rmSync(root, { recursive: true, force: true });
}
