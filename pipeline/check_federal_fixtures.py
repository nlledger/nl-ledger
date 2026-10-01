"""Parse real amendment excerpts in the fixture sandbox and check reviewed outcomes.

Called by check_fixtures.py with NL_LEDGER_DATA set to its temporary directory.
No fetch, Public Accounts, production-volume bounds, or main-cache writes.
"""
import csv
import json
import os
import sys
from decimal import Decimal
from pathlib import Path

import parse_federal as parser
from build import iid
from federal_evidence import evidence

CASES = Path(__file__).resolve().parent.parent / "tests/fixtures/federal/amendment-cases.json"


def main():
    if not os.environ.get("NL_LEDGER_DATA"):
        raise SystemExit("Run through check_fixtures.py: NL_LEDGER_DATA must name the fixture sandbox")
    parser.contracts(check_total=False)
    parser.grants(check_total=False)
    files = {"fed_contract": "fed_contracts.csv", "fed_grant": "fed_grants.csv"}
    parsed = {}
    for dataset, filename in files.items():
        with (parser.CLEAN / filename).open(newline="") as fh:
            parsed[dataset] = list(csv.DictReader(fh))
    problems = []
    national = 0
    for case in json.loads(CASES.read_text())["cases"]:
        dataset = case["dataset"]
        key = "procurement_id" if dataset == "fed_contract" else "agreement_number"
        matches = [r for r in parsed[dataset] if r["owner_org"] == case["department"] and r[key] == case[key]]
        label = f"{dataset} {case['department']} {case[key] or 'unnumbered'}"
        if len(matches) != 1:
            problems.append(f"{label}: {len(matches)} records parsed, 1 expected")
            continue
        row = matches[0]
        expected = case["expected"]
        for field in ("reference_number", "ref_number", "vendor", "recipient", "rows", "versions", "amount"):
            if field not in expected:
                continue
            actual, wanted = row[field], expected[field]
            if field == "amount":
                actual, wanted = Decimal(actual), Decimal(wanted)
            elif field in {"rows", "versions"}:
                actual = int(actual)
            if actual != wanted:
                problems.append(f"{label} {field}: {actual!r} parsed, {wanted!r} expected")
        if dataset == "fed_grant":
            rule = "sum of" if case["department"] in parser.CHANGE_REPORTING else "latest of"
            if not row["how"].startswith(rule):
                problems.append(f"{label}: counting rule {row['how']!r}, expected {rule!r}")
        else:
            history = json.loads(row["amendment_history"])
            actual_refs = sorted((r["department"], r["reference_number"]) for r in history)
            wanted_refs = sorted((case["department"], r["reference_number"]) for r in case["source_rows"])
            if actual_refs != wanted_refs:
                problems.append(f"{label}: amendment provenance does not preserve every selected source reference")
        if "scope_status" in expected:
            item = {"dataset": dataset, "id": iid(dataset, row["owner_org"], row["procurement_id"] or row["reference_number"], row["vendor"].lower()),
                    "source_url": row["source_url"], "locator": f"CSV line {row['csv_line']}", "amount": float(row["amount"])}
            facts = evidence(item, row)
            actual = {"scope_status": facts["scope_status"], "scope_review_state": facts["scope_review_state"],
                      "work_or_delivery": facts["source_geography"]["work_or_delivery"],
                      "inclusion_field": facts["inclusion_rule"]["field"],
                      "no_nl_share": "no NL share is reported" in facts["scope_statement"],
                      "reported_postal_code": facts["reported_location"]["postal_code"]}
            for field, value in actual.items():
                if value != expected[field]:
                    problems.append(f"{label} {field}: {value!r} parsed, {expected[field]!r} expected")
            if facts["scope_evidence"] == []:
                problems.append(f"{label}: national label has no supporting source evidence")
            national += int(facts["scope_status"] == expected["scope_status"])
    parser.REPORT["national_contracts"] = national
    (parser.CLEAN / "federal_fixture_report.json").write_text(json.dumps(parser.REPORT, indent=1))
    for problem in problems:
        print("FAIL " + problem)
    return int(bool(problems))


if __name__ == "__main__":
    sys.exit(main())
