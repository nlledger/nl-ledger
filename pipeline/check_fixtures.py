"""Reconciliation on a small set of real source files, for CI.

The full pipeline downloads every source (federal files of several hundred MB), so pull
requests cannot run it. tests/fixtures/cache holds one real file per source that prints its
own totals:

  ministers  one minister's expense report     parsed lines add to the report's Total line
  mha        one member's detail and summary   each category adds to its Period Activity;
                                               the detail adds to the summary
  crf        one year's program spending       each department's gross adds to the summary
                                               statement (to the $1,000 it is rounded to)
  estimates  the same year's Estimates         each department's program lines add to its printed
                                               total; the budget's cash summary, and the Original
                                               column the report reprints, equal the Estimates
  public-    the three consolidated            revenue less expense is the printed deficit;
  accounts   statements of the same year       liabilities less financial assets is net debt
             (four pages of the real file)
  sunshine   one employer's pay disclosure     each person's pay parts add to the total
  federal    real grant and contract chains    reviewed counts, values and national scope;
                                               these sources print no reconciliation total

The parsers run on a copy of those files (NL_LEDGER_DATA points them at it), then every
check must pass, and the counts must match tests/fixtures/expected.json so a parser that
silently drops rows fails too. Exit 1 on any failure.

  uv run python check_fixtures.py            # run the checks
  uv run python check_fixtures.py --update   # rewrite expected.json after a reviewed change
"""
import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "tests" / "fixtures"
PARSERS = ["parse_ministers.py", "parse_mha.py", "parse_programs.py", "parse_fiscal.py", "parse_sunshine.py", "check_federal_fixtures.py"]


def rows(clean: Path, name: str) -> list[dict]:
    p = clean / name
    return list(csv.DictReader(open(p, newline=""))) if p.exists() else []


def num(v) -> float:
    return float(v or 0)


def main() -> int:
    work = Path(tempfile.mkdtemp(prefix="nl-ledger-fixtures-"))
    shutil.copytree(FIXTURES / "cache", work / "cache")
    env = {**os.environ, "NL_LEDGER_DATA": str(work)}
    for script in PARSERS:
        r = subprocess.run([sys.executable, script], cwd=HERE, env=env, capture_output=True, text=True)
        if r.returncode:
            print(f"FAIL {script} stopped:\n{r.stdout[-2000:]}{r.stderr[-2000:]}")
            return 1
    clean = work / "clean"
    problems = []

    claims = rows(clean, "minister_claims.csv")
    problems += [f"minister report {c['file']}: {c['issue']}" for c in rows(clean, "ministers_check.csv")]

    lines, summary = rows(clean, "mha_lines.csv"), rows(clean, "mha_summary.csv")
    problems += [f"MHA {c['member']} {c['category']}: lines add to {c['parsed']}, Period Activity {c['period_activity']}"
                 for c in rows(clean, "mha_check.csv")]
    detail, summ = sum(num(r["amount"]) for r in lines), sum(num(r["spent"]) for r in summary)
    if abs(detail - summ) > 0.01:
        problems.append(f"MHA detail lines add to {detail:,.2f}, summary report {summ:,.2f}")

    programs = rows(clean, "program_check.csv")
    problems += [f"program spending {c['fiscal_year']} {c['department']} ({c['account']}): parsed {c['parsed']}, "
                 f"summary statement {c['summary']} (page {c['page']})" for c in programs if c["ok"] != "True"]

    fiscal_checks = rows(clean, "fiscal_check.csv")
    problems += [f"budget and accounts {c['fiscal_year']}: {c['what']}: {c['a'] or 'not found'} against {c['b'] or 'not found'}"
                 for c in fiscal_checks if c["ok"] != "True"]

    pay = rows(clean, "sunshine.csv")
    parts = ("base", "overtime", "bonus", "shift", "retro", "severance", "other")
    problems += [f"pay disclosure {r['source_file']} row {r['row']}: parts add to {sum(num(r[k]) for k in parts):,.2f}, "
                 f"total {num(r['total']):,.2f}" for r in pay
                 if abs(sum(num(r[k]) for k in parts) - num(r["total"])) > 300]  # the publisher rounds each part to $100

    counts = {"minister_claim_lines": len(claims), "minister_total": round(sum(num(r["amount"]) for r in claims), 2),
              "mha_lines": len(lines), "mha_total": round(detail, 2),
              "program_departments_checked": len(programs), "program_lines": len(rows(clean, "program_lines.csv")),
              "budget_figures": len(rows(clean, "fiscal.csv")), "budget_checks": len(fiscal_checks),
              "budget_departments": len(rows(clean, "dept_budget.csv")),
              "pay_rows": len(pay), "pay_total": round(sum(num(r["total"]) for r in pay), 2)}
    federal = json.loads((clean / "federal_fixture_report.json").read_text())
    counts.update({"federal_grant_raw_rows": federal["grants"]["raw_rows"],
                   "federal_grant_raw_total": federal["grants"]["raw_value"],
                   "federal_agreements": federal["grants"]["agreements"],
                   "federal_grant_total": federal["grants"]["dedup_value"],
                   "federal_contract_raw_rows": federal["contracts"]["raw_rows"],
                   "federal_contract_raw_total": federal["contracts"]["raw_value"],
                   "federal_contracts": federal["contracts"]["procurements"],
                   "federal_contract_total": federal["contracts"]["dedup_value"],
                   "federal_national_contracts": federal["national_contracts"]})
    expected_file = FIXTURES / "expected.json"
    if "--update" in sys.argv:
        expected_file.write_text(json.dumps(counts, indent=1) + "\n")
        print(f"wrote {expected_file.relative_to(HERE.parent)}")
    else:
        expected = json.loads(expected_file.read_text())
        problems += [f"{k}: {counts.get(k)} parsed, {v} expected (tests/fixtures/expected.json)"
                     for k, v in expected.items() if counts.get(k) != v]
    shutil.rmtree(work)

    for k, v in counts.items():
        print(f"  {k}: {v:,}" if isinstance(v, int) else f"  {k}: {v:,.2f}")
    if problems:
        print(f"FAIL: {len(problems)} figures do not reconcile")
        for p in problems:
            print("  " + p)
        return 1
    print(f"PASS: {len(programs)} department totals, {len(fiscal_checks)} budget and Public Accounts checks, {len(summary)} MHA categories, "
          f"the minister report and {len(pay)} pay rows reconcile with their sources' printed totals; "
          f"{counts['federal_agreements']} federal agreements and {counts['federal_contracts']} contracts match reviewed source rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
