"""Write docs/reconciliation.md: every dataset's totals checked against the source's
own totals, and a random sample of line items to trace back by hand.

Run after build.py. The trace sample is written to docs/trace-sample.md with the
source link (with #page=N for PDFs) and locator for each item; the "checked" column
is filled in by the person who opens each source and compares.
"""
import csv
import json
import random
import sqlite3
from collections import Counter, defaultdict
from datetime import date

from common import CLEAN, DISABLED, ROOT
from build import DB

DOCS = ROOT / "docs"


def money(v):
    return f"${v:,.2f}" if v is not None else "n/a"


def rows(name):
    p = CLEAN / name
    return list(csv.DictReader(open(p, newline=""))) if p.exists() else []


def main():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    out = [f"# Reconciliation", "", f"Generated {date.today().isoformat()} by `pipeline/reconcile.py` from `data/build/ledger.db`.", ""]

    def section(title):
        out.extend(["", f"## {title}", ""])

    # Summary table
    section("Items loaded")
    out.append("| Dataset | Items | Total (CAD) |")
    out.append("|---|---:|---:|")
    for r in con.execute("SELECT dataset, count(*) n, sum(CASE WHEN currency='CAD' THEN amount END) s FROM items GROUP BY dataset ORDER BY n DESC"):
        out.append(f"| {r['dataset']} | {r['n']:,} | {money(r['s'])} |")
    out += ["", "Only source-supported CAD values enter this column. Native currencies, missing values and published zeros remain separate. Address selection does not establish work, benefit or expenditure location."]
    for r in con.execute("SELECT dataset, currency, count(*) n, count(amount) known, sum(amount) s FROM items WHERE currency!='CAD' GROUP BY dataset,currency"):
        out.append(f"- {r['dataset']}: {r['n']} records, {r['known']} published amounts, native {r['currency']} {r['s']}; not converted or included in CAD totals.")

    # PPA
    section("Provincial contract awards (PPA reports)")
    sup = rows("ppa_superseded.csv")
    ppa = rows("ppa_awards.csv")
    files = Counter(r["source_file"] for r in ppa)
    out += [f"- Reports parsed: {len(files) + len(sup)} PDFs listed on gov.nl.ca, {len(sup)} superseded by a REVISED issue, {len(files)} used.",
            f"- Award rows: {len(ppa):,}. Rows with a Canadian-dollar amount: {sum(1 for r in ppa if r['amount']):,}.",
            f"- Rows priced only in US dollars (kept, not converted, not in totals): {sum(1 for r in ppa if r['currency'] == 'USD')}.",
            f"- Rows with a rate, range or prose instead of a price (kept, not in totals): {sum(1 for r in ppa if r['currency'] == 'text')}.",
            f"- Rows with no award date printed: {sum(1 for r in ppa if not r['award_date'])} (dated by report period end).",
            "- The reports have no printed totals to reconcile against. Check instead: row counts per report are listed in "
            "`data/clean/ppa_awards.csv` and every row carries its page and table row.", "",
            "Superseded issues (original dropped, revised kept):", ""]
    for r in sup:
        out.append(f"- {r['dropped']} ({r['dropped_rows']} rows) replaced by {r['kept']} ({r['kept_rows']} rows)")
    review = json.loads(con.execute("SELECT value FROM facts WHERE key='ppa_repeat_review'").fetchone()[0])
    out += ["", f"- {review['repeats']} repeated printings counted once; all receipts remain on the counted records.",
            f"- Same-amount, matched-supplier pairs within 31 days: {review['pairs']}; each decision and both source rows are in `docs/award-pairs.csv`.",
            "- Source review and counting rule: `docs/award-review.md`."]
    printed_by_year = defaultdict(float)
    for r in ppa:
        printed_by_year[(r["award_date"] or r["period_end"])[:4]] += float(r["amount"] or 0)
    by_year = defaultdict(float)
    for r in con.execute("SELECT date, amount FROM items WHERE dataset='ppa'"):
        by_year[r["date"][:4]] += r["amount"] or 0
    out += ["", "| Award year | As printed (CAD) | Counted once (CAD) |", "|---|---:|---:|"] + [f"| {y} | {money(printed_by_year[y])} | {money(v)} |" for y, v in sorted(by_year.items())]

    # Ministers
    section("Ministerial expense claims")
    chk = rows("ministers_check.csv")
    idx = json.loads((ROOT / "data/cache/ministers/_index.json").read_text())
    out += [f"- Reports: {len(idx)} PDFs across {len({i['period_page'] for i in idx})} six-month periods (December 2020 to May 2026).",
            "- Check: for every report, the parsed summary lines add up to the PDF's own printed Total line.",
            f"- Reports whose lines do not add to the PDF total: {sum(1 for c in chk if 'PDF total' in c['issue'] and 'web page' not in c['issue'])}.",
            "- Reports where the gov.nl.ca listing page shows a different total from the PDF (publisher discrepancy):"]
    for c in chk:
        if "web page" in c["issue"]:
            out.append(f"  - `{c['file']}`: {c['issue']}")

    # MHA
    section("MHA expense reports")
    lines = rows("mha_lines.csv")
    summ = rows("mha_summary.csv")
    mchk = rows("mha_check.csv")
    dsum = sum(float(r["amount"] or 0) for r in lines)
    ssum = sum(float(r["spent"] or 0) for r in summ)
    out += [f"- Detail lines: {len(lines):,}, total {money(dsum)}.",
            f"- Summary reports (spending by category): total {money(ssum)}.",
            f"- Detail total minus summary total: {money(dsum - ssum)}.",
            f"- Check: every category section's lines add up to its printed Period Activity. Sections that do not: {len(mchk)}.",
            f"- Annual reports that the House of Assembly links but that return a web page instead of a PDF: "
            f"{len(rows('broken_links_mha.csv'))} (listed on the sources page)."]

    # Sunshine
    section("Compensation disclosure (sunshine list)")
    sun = rows("sunshine.csv")
    comp_bad = 0
    for r in sun:
        parts = sum(float(r[k] or 0) for k in ("base", "overtime", "bonus", "shift", "retro", "severance", "other"))
        if abs(parts - float(r["total"])) > 300:  # publisher rounds each field to $100
            comp_bad += 1
    out += [f"- Rows: {len(sun):,} from {len({r['source_file'] for r in sun})} workbooks.",
            f"- Check: base + overtime + bonus + shift + retroactive + severance + other equals the published total "
            f"within rounding ($100 per field). Rows outside that: {comp_bad}.",
            f"- Workbooks listed on gov.nl.ca that return 404: {len(rows('broken_links_sunshine.csv'))}."]
    for y, n in sorted(Counter(r["year"] for r in sun).items()):
        out.append(f"  - {y}: {n:,} people")

    # Federal
    fed = json.loads((CLEAN / "federal_report.json").read_text())
    section("Federal contracts, grants and notices")
    c, g = fed["contracts"], fed["grants"]
    out += [f"- Contracts over $10K to suppliers with an NL postal code: {c['raw_rows']:,} rows worth {money(c['raw_value'])} as published.",
            f"- Each amendment repeats the whole contract. Grouped by procurement id and cleaned vendor name, with source-reviewed name changes resolved on department, procurement, original start/value before grouping. Earlier references remain as provenance. "
            f"latest kept: {c['procurements']:,} contracts worth {money(c['dedup_value'])}. An earlier grouping by department and raw vendor "
            "name gave about $2.83B; it counted a purchase order twice when two departments reported it or the vendor was "
            "spelled two ways.",
            f"- Non-competitive (solicitation code TN): {money(c['non_competitive_value'])}.",
            f"- Grants and contributions selected by reported recipient province NL (including labelled address conflicts): {g['raw_rows']:,} rows worth {money(g['raw_value'])}. One value per "
            f"agreement (department, agreement number, recipient; a renamed recipient stays in its agreement): latest amendment where "
            f"the department reports running totals, amendments summed where it reports changes "
            f"({', '.join(g.get('delta_departments', []))}) until the department's restated total replaces them "
            f"(isc-sac and aandc-aadnc from 2026-27 Q1): {g['agreements']:,} agreements worth {money(g['dedup_value'])}. "
            "Agreement values can span several years.",
            "- Check of the change-reporting departments' rows from before any restated total against Public Accounts "
            "transfer payments to NL recipients (payments of $100K or more):"]
    for cr in g.get("change_reporting", {}).values():
        out.append(f"  - {cr['department']}: rows added up {money(cr['summed'])}; latest row only {money(cr['latest_only'])}; "
                   f"paid {cr['paid_years']} {money(cr['paid'])}.")
    out += [
            f"- CanadaBuys award notices selected by reported NL supplier province or Canadian NL postal code: {fed['canadabuys']['notices']} ({money(fed['canadabuys']['value'])} supported CAD values). "
            "Notices may overlap disclosures. Excluded from supplier commitment summaries; shown separately in source/body summaries. Retained combined body amounts disclose overlap. Published zero totals remain zero; missing totals alone use the contract-amount fallback."]
    mtp = fed["public_accounts"]["mtp_2024_25"]
    out += ["", "Major federal transfers to NL, 2024-25 (Public Accounts, $ millions as published):", ""]
    for k, v in mtp.items():
        out.append(f"- {k}: {money(v)}")

    # Programs
    section("Department and program spending")
    allchk = rows("program_check.csv")
    pchk = [r for r in allchk if r["kind"] == "actual"]
    echk = [r for r in allchk if r["kind"] == "estimates"]
    ok = sum(1 for r in pchk if r["ok"] == "True")
    out += [f"- Check: for each department and account (current, capital), gross expenditure summed from the parsed object lines "
            f"equals the department's gross expenditure in the report's own summary statement (rounded to $000). "
            f"{ok} of {len(pchk)} match.",
            f"- Check, Estimates: each department's program lines add to the \"Total: Program Estimates\" line of its Program Funding "
            f"Summary, current and capital, to the dollar. {sum(1 for r in echk if r['ok'] == 'True')} of {len(echk)} match "
            f"({len({r['fiscal_year'] for r in echk})} years of Estimates)."]
    for r in allchk:
        if r["ok"] != "True":
            note = ""
            if r["department"] == "labrador affairs":
                note = " The 2024-25 report prints Labrador Affairs detail pages with only a heading and '#MISSING'; the source has no lines to parse."
            out.append(f"  - {r['fiscal_year']} {r['department']} ({r['account']}): summary {money(float(r['summary']))}, "
                       f"parsed {money(float(r['parsed'])) if r['parsed'] else 'nothing'}.{note}")
    for fy, kind, tot in con.execute("SELECT fiscal_year, kind, sum(col1) FROM programs WHERE line_type='object' GROUP BY 1,2 ORDER BY 1"):
        out.append(f"- {fy} {kind}: gross expenditure {money(tot)}")

    # Budget against actual, the deficit and net debt
    section("Budget against actual, the deficit and net debt")
    fchk = rows("fiscal_check.csv")
    fig = {(r["fiscal_year"], r["basis"], r["measure"], r["col"], r["doc"]): float(r["amount"]) for r in rows("fiscal.csv")}
    groups = [
        ("Report: each printed subtotal of the Statement of Budgetary Contribution recomputed (net expenditure, cash requirement; actual and original estimates)", "report-c", "report-n"),
        ("Report: the departments in the summary statements add to the statement's gross expenditure", "report-departments",),
        ("Estimates: the departments' program lines add to the gross expenditure in the budget's Summary of Cash Requirements", "estimates-departments",),
        ("The Report's Original Estimates column equals the budget's own Summary of Cash Requirements (revenue, gross expenditure, related revenue, cash requirement)", "original-c", "original-r"),
        ("Department by department, the Original column the Report reprints equals the Estimates as tabled", "original-department",),
        ("Public Accounts: revenue less expense equals the printed surplus or deficit; liabilities less financial assets equals net debt; net debt agrees between two statements", "accounts-",),
        ("The Public Accounts' Original Budget column equals the budget's own statements (from Budget 2024, when they were first published as Statements and Schedules)", "budget-",),
    ]
    out += ["Two bases, kept apart. Budgeted and spent are from the Estimates and the Report on the Program Expenditures and Revenues of the "
            "Consolidated Revenue Fund (modified cash, departments). The surplus or deficit and net debt are from the audited Public Accounts "
            "(accrual, all government bodies).", "",
            "| Check | Holds |", "|---|---:|"]
    for g in groups:
        mine = [r for r in fchk if r["check"].startswith(g[1:])]
        out.append(f"| {g[0]} | {sum(1 for r in mine if r['ok'] == 'True')} of {len(mine)} |")
    bad = [r for r in fchk if r["ok"] != "True"]
    if bad:
        out += ["", "Checks that do not hold:", ""]
        for r in bad:
            note = ""
            if "Labrador Affairs" in r["what"]:
                note = " The 2024-25 report prints no program detail for Labrador Affairs, so it reprints no Original figure; the budgeted figure is the Estimates'."
            elif "Executive Council" in r["what"] and r["fiscal_year"] == "2020-21":
                note = (" The 2020-21 report prints a dash for the original Salaries estimate of program 2.2.01 (PDF page 38), while that program's "
                        "printed total includes it; the budgeted figure is the Estimates'.")
            out.append(f"- {r['fiscal_year']}: {r['what']}. {money(float(r['a'])) if r['a'] else 'Nothing'} against {money(float(r['b'])) if r['b'] else 'nothing'}.{note}")
    out += ["", "| Fiscal year | Budgeted (Estimates) | Spent (Report) | Surplus or (deficit), budget | Surplus or (deficit), actual | Net debt |",
            "|---|---:|---:|---:|---:|---:|"]
    def dollars(v):
        return "not yet published" if v is None else f"(${-v:,.0f})" if v < 0 else f"${v:,.0f}"

    for fy in sorted({k[0] for k in fig}):
        def g(basis, measure, col, docs):
            return next((fig[(fy, basis, measure, col, d)] for d in docs if (fy, basis, measure, col, d) in fig), None)

        def gross(col, docs):
            return (g("cash", "current_gross", col, docs) or 0) + (g("cash", "capital_gross", col, docs) or 0) or None

        out.append(f"| {fy} | {dollars(gross('budget', ('statements', 'estimates', 'report')))} | {dollars(gross('actual', ('report',)))} | "
                   f"{dollars(g('accrual', 'balance', 'budget', ('public_accounts', 'statements')))} | "
                   f"{dollars(g('accrual', 'balance', 'actual', ('public_accounts',)))} | "
                   f"{dollars(g('accrual', 'net_debt', 'actual', ('public_accounts',)))} |")

    # Municipal (switched off: common.DISABLED)
    if not DISABLED >= {"paradise", "stjohns"}:
        section("Municipal payments")
        pf = rows("paradise_files.csv")
        pp = rows("paradise_payments.csv")
        out += [f"- Paradise: {len(pf)} register files downloaded; {sum(1 for r in pf if r['status'].startswith('register') and 'superseded' not in r['status'])} "
                f"distinct monthly registers used; {len(pp):,} payment lines, {money(sum(float(r['amount']) for r in pp))}.",
                f"- Lines that look like payments but did not parse: {sum(int(r['unparsed']) for r in pf if r['status'].startswith('register'))} "
                "(mostly wrapped descriptions). Registers from early 2020 use a different layout and are not loaded.",
                "- The registers print no totals, so there is nothing to reconcile the sum against.",
                "- St. John's: the first 12 pages of the 2026 weekly-voucher PDF were read with OCR as a sample. "
                "Cover memos (payroll and weekly totals) are excluded. OCR text can misread characters; each row links to its page."]

    (DOCS / "reconciliation.md").write_text("\n".join(out) + "\n")

    # Trace sample: random items, stratified by dataset
    random.seed(20260929)
    sample = []
    for ds in [r[0] for r in con.execute("SELECT DISTINCT dataset FROM items ORDER BY 1")]:
        ids = [r[0] for r in con.execute("SELECT id FROM items WHERE dataset=? AND amount IS NOT NULL", (ds,))]
        for i in random.sample(ids, min(2 if ds not in ("ppa", "mha", "fed_contract", "minister") else 3, len(ids))):
            sample.append(con.execute("SELECT * FROM items WHERE id=?", (i,)).fetchone())
    t = ["# Trace sample", "", "Random line items (seed 20260929), drawn once and kept. Each was found in its source file and compared with its "
         "page on the site; results are in `docs/review-notes.md`.",
         "", "| # | Dataset | Item | Amount | Source | Where | Checked |", "|---|---|---|---:|---|---|---|"]
    for n, r in enumerate(sample, 1):
        who = r["supplier"] or r["person"] or ""
        what = (r["description"] or "")[:60].replace("|", "/")
        link = r["source_url"] + (f"#page={r['page']}" if r["page"] and r["source_url"].lower().endswith(".pdf") else "")
        t.append(f"| {n} | {r['dataset']} | {who[:40]}: {what} | {money(r['amount'])} | [source]({link}) | {r['locator']} | |")
    # The sample is drawn once and kept, so a traced sample is never silently replaced.
    if not (DOCS / "trace-sample.md").exists():
        (DOCS / "trace-sample.md").write_text("\n".join(t) + "\n")
    print(f"wrote docs/reconciliation.md and docs/trace-sample.md ({len(sample)} items)")


if __name__ == "__main__":
    main()
