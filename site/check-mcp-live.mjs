// Sample HTTP smoke (starts dev.mjs): node site/check-mcp-live.mjs --sample
// Full locally built ledger, with a running Worker: node site/check-mcp-live.mjs [origin].
import assert from 'node:assert/strict';
import { load } from './src/data.mjs';
import { money, moneyWords, num } from './lib/format.mjs';
import { computeReceipt, renderReceipt } from './lib/receipt.mjs';
import { payJSON } from './src/paydata.mjs';
import { bodiesJSON } from './src/bodydata.mjs';
if (process.argv[2] === '--sample') {
  await import('./check-mcp-sample.mjs');
  process.exit(0);
}
const origin=process.argv[2] || 'http://localhost:8793';
const D=load();
const json=async path=>{const r=await fetch(origin+path);assert.equal(r.status,200,path);return r.json();};
const html=async path=>{const r=await fetch(origin+path);assert.equal(r.status,200,path);return r.text();};
async function tool(name,args={}) {
  const r=await fetch(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
  assert.equal(r.status,200);const j=await r.json();assert.equal(j.error,undefined);assert.equal(j.result.isError,false,JSON.stringify(j));return j.result.structuredContent;
}
// Safe HTTP proof: one small batch and one 65,537-byte chunked body, no flood.
const listCall = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const batch = await fetch(origin + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([listCall, { ...listCall, id: 2 }]) });
assert.equal(batch.status, 400); assert.equal((await batch.json()).error.code, -32600);
const ping = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' });
const raw = new TextEncoder().encode(ping + ' '.repeat(65537 - ping.length));
let offset = 0;
const streamed = new ReadableStream({ pull(controller) {
  if (offset >= raw.length) { controller.close(); return; }
  const end = Math.min(offset + 16384, raw.length);
  controller.enqueue(raw.slice(offset, end)); offset = end;
} });
const oversized = await fetch(origin + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: streamed, duplex: 'half' });
assert.equal(oversized.status, 413); assert.equal((await oversized.json()).error.code, -32600);
const normal = await fetch(origin + '/mcp', { method: 'POST', body: ping });
assert.equal(normal.status, 200); assert.deepEqual((await normal.json()).result, {});
for(const employer of payJSON(D).employers.filter(e=>['Memorial University','Core public service','NL Health Services'].includes(e.employer))) {
  const got=await tool('get_pay',{employer:employer.employer});const page=await html(employer.page_url);
  assert.deepEqual(got.by_year,employer.by_year);
  for(const year of got.by_year) if(year.status==='published') { assert.ok(page.includes(moneyWords(year.total_cad)));assert.ok(page.includes(num(year.people))); }
}
for(const body of bodiesJSON(D).filter(b=>['NL Health Services','Newfoundland and Labrador Hydro','Health Canada'].includes(b.buyer))) {
  const got=await tool('get_body',{name:body.buyer});const page=await html(body.page_url);
  assert.equal(got.reported_record_values_cad,body.amount);assert.ok(page.includes(moneyWords(body.amount)));
  assert.deepEqual(got.by_year,JSON.parse(JSON.stringify(body.byYear)));
  for(const s of got.largest_suppliers) assert.ok(page.includes(moneyWords(s.reported_value_cad||0)));
}
const R=await json('/data/receipt.json');
for(const income of [0,25000,55000,100000,55000.99]) {
  const got=await tool('tax_receipt',{income}),c=computeReceipt(R,Math.floor(income)),page=await html(`/receipt/?income=${income}`);
  assert.equal(got.estimated_provincial_income_tax_cad,c.tax);assert.ok(page.includes(renderReceipt(R,Math.floor(income),D.stats)));
  for(let i=0;i<c.lines.length;i++) assert.equal(got.departments[i].illustrated_tax_share_cad,c.lines[i].yours);
}
const got=await tool('get_totals',{body:'NL Health Services',source:'ppa',year:'2025',group_by:'supplier',limit:3});
const key=D.one("SELECT buyer_key k FROM buyers WHERE buyer='NL Health Services'").k;
const want=D.q("SELECT supplier_key, sum(amount) value, count(*) n FROM items WHERE buyer_key=? AND dataset='ppa' AND substr(date,1,4)='2025' AND currency='CAD' AND supplier_key IS NOT NULL GROUP BY supplier_key ORDER BY value DESC LIMIT 3",key);
const rows=got.partitions.find(p=>p.currency==='CAD').groups;
assert.deepEqual(rows.map(g=>g.id),want.map(g=>D.keyHash(g.supplier_key)));
for(let i=0;i<rows.length;i++) { assert.ok(Math.abs(rows[i].value-want[i].value)<.01);assert.equal(rows[i].records,want[i].n);const url=new URL(rows[i].records_url);assert.ok((await html(url.pathname+url.search)).includes('Search')); }
const aliases=await tool('get_totals',{supplier:'Pennecon Industrial Ltd',source:'ppa',group_by:'year'});
const canonical=await tool('get_totals',{supplier:'Pennecon Industrial Limited',source:'ppa',group_by:'year'});
assert.equal(aliases.filters.supplier_id,canonical.filters.supplier_id);assert.deepEqual(aliases.partitions,canonical.partitions);
const all=await tool('get_totals',{group_by:'source'});
for(const p of all.partitions) {
  const g=p.groups[0],r=D.one("SELECT count(*) n,sum(amount) value FROM items WHERE dataset=? AND currency=?",p.source,p.currency);
  assert.equal(g.records,r.n);assert.ok(Math.abs((g.value||0)-(r.value||0))<.01);
}
assert.ok(all.partitions.some(p=>p.currency==='USD'));assert.ok(all.partitions.some(p=>p.currency==='unstated'));
assert.ok(all.partitions.filter(p=>['pa_pss','pa_tp','canadabuys'].includes(p.source)).every(p=>!p.included_in_summary));
console.log('Real Worker MCP limits, full-ledger SQL, published aliases and page readback: pass');
D.db.close();
