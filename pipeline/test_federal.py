"""Portable source-to-evidence regressions, using the audit's actual publisher rows."""
import contextlib
import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

import fetch_federal
import parse_federal as parser
from check_federal import ROOT, EXPECTED
from federal_evidence import PSS_PAYEE_FIELD, evidence, is_nl_postal, notice_selected, pss_location, location_conflict

FIXTURES = json.loads((ROOT / "tests/fixtures/federal/counterexamples.json").read_text())
CHAIN = json.loads((ROOT / "tests/fixtures/federal/health-chain.json").read_text())


def csvfile(path, rows):
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, list(rows[0]))
        w.writeheader()
        w.writerows(rows)


class FederalTests(unittest.TestCase):
    def test_address_selection(self):
        for pc in ("A1N", "A1B 3N9", "a0p1l0"):
            self.assertTrue(is_nl_postal(pc))
        for pc in ("A98 N7D5", "A", "A12", "A1D 1D1", "K1A 0A6", ""):
            self.assertFalse(is_nl_postal(pc))
        self.assertFalse(notice_selected(FIXTURES["35bb90c1f35e"]["raw"]))
        for id in ("af355141e3d1", "7698e532de4f"):
            self.assertIsNone(pss_location(FIXTURES[id]["raw"][PSS_PAYEE_FIELD]))
        self.assertIsNotNone(pss_location("A company, with a comma, St. John's, Newfoundland and Labrador"))
        self.assertIsNotNone(pss_location("A company, St. John's, Newfoundland & Labr."))
        self.assertFalse(notice_selected({"supplierAddressCountry-fournisseurAdressePays-eng": "Ireland", "supplierAddressProvince-fournisseurAdresseProvince-eng": "NL", "supplierAddressPostalCode-fournisseurAdresseCodePostal": "A1B 3N9"}))
        self.assertIn("not a valid Canadian", location_conflict({"province": "NL", "postal_code": "A98 N7D5"}))

    def test_chain_identity_does_not_merge_an_unrelated_contract(self):
        home = CHAIN[-1]
        self.assertEqual(len({parser.contract_identity(r) for r in CHAIN}), 1)
        for field, value in (("owner_org", "another-department"), ("original_value", "1"),
                             ("contract_period_start", "2021-04-08"), ("procurement_id", "another-id"),
                             ("vendor_name", "Unrelated supplier")):
            self.assertNotEqual(parser.contract_identity(home), parser.contract_identity({**home, field: value}))

    def test_unreviewed_prose_is_not_absent_source_evidence(self):
        it = FIXTURES["352559efa91e"]["item"]
        raw = FIXTURES["352559efa91e"]["raw"]
        r = {"source_fields": json.dumps(raw), "postal_code": "A0P"}
        x = evidence({**it, "id": "fed_contract-unreviewed"}, r)
        self.assertEqual(x["scope_status"], "unknown")
        self.assertEqual(x["scope_review_state"], "unreviewed")
        self.assertEqual(x["scope_statement"], "NL Ledger has not established the work, benefit or jurisdiction from this record; source fields are available below.")
        self.assertEqual(x["scope_evidence"], [])
        self.assertIn("Goose Bay", x["source_fields"]["additional_comments_en"])
        r = {**r, "source_fields": json.dumps({**raw, "additional_comments_en": ""})}
        review = {"status": "unknown", "statement": "The reviewed source fields do not establish work or benefit location", "fields": {"additional_comments_en": ""}, "places": []}
        with patch("federal_evidence.REVIEWS", {"unreviewed": review}):
            reviewed = evidence({**it, "id": "fed_contract-unreviewed"}, r)
        self.assertEqual(reviewed["scope_review_state"], "reviewed")
        self.assertEqual(reviewed["scope_status"], "unknown")

    def test_transfer_receipt_is_not_address_or_subsequent_spending(self):
        it = FIXTURES["da13771f1372"]["item"]
        raw = FIXTURES["da13771f1372"]["raw"]
        def classify(fields):
            return evidence(it, {"source_fields": json.dumps(fields), "province": fields["Prov-Terr_eng"]})
        x = classify(raw)
        self.assertEqual(x["scope_review_state"], "reviewed")
        self.assertEqual(x["source_geography"]["work_or_delivery"], [])
        self.assertEqual(x["source_geography"]["beneficiary_or_jurisdiction"], ["Province of Newfoundland and Labrador"])
        self.assertIn("jurisdictional receipt, not subsequent spending", x["scope_statement"])
        for name in ["A supplier in Newfoundland and Labrador", "Province of Newfoundland and Labrador (Names Withheld - 7 Recipients)", "Government of Manitoba"]:
            self.assertEqual(classify({**raw, "Rcpt-nm-locn_Nm-lieu-bnfcrs_eng": name})["scope_review_state"], "unreviewed")
        self.assertEqual(classify({**raw, "Prov-Terr_eng": "Ontario"})["scope_status"], "unknown")

    def test_renamed_public_accounts_column_is_named_in_the_error(self):
        with tempfile.TemporaryDirectory() as td:
            fed = Path(td)
            raw = next(v["raw"] for v in FIXTURES.values() if v["item"]["dataset"] == "pa_pss")
            csvfile(fed / "pss-2022.csv", [{("Proj-desc_eng" if k == PSS_PAYEE_FIELD else k): v for k, v in raw.items()}])
            with patch.object(parser, "FED", fed), self.assertRaises(ValueError) as caught:
                parser.public_accounts()
            self.assertIn(f"pss-2022.csv: column '{PSS_PAYEE_FIELD}' is missing", str(caught.exception))

    def test_source_fields_and_counterexamples(self):
        with tempfile.TemporaryDirectory() as td:
            fed = Path(td)
            out = {}
            contracts = CHAIN + [v["raw"] for id, v in FIXTURES.items() if v["item"]["dataset"] == "fed_contract" and id not in {"c5500509042d", "909f02da7ae3"}]
            notices = [v["raw"] for v in FIXTURES.values() if v["item"]["dataset"] == "canadabuys"]
            grants = [v["raw"] for v in FIXTURES.values() if v["item"]["dataset"] == "fed_grant"]
            csvfile(fed / "contracts.csv", contracts)
            csvfile(fed / "awardNoticeComplete.csv", notices)
            (fed / "grants_NL.jsonl").write_text("\n".join(json.dumps(r) for r in grants))
            for y in (2022, 2023, 2024, 2025):
                for ds, prefix in (("pa_pss", "pss"), ("pa_tp", "tp")):
                    rows = [v["raw"] for v in FIXTURES.values() if v["item"]["dataset"] == ds]
                    csvfile(fed / f"{prefix}-{y}.csv", rows)
            with patch.object(parser, "FED", fed), patch.object(parser, "write", lambda name, rows: out.update({name: rows})), contextlib.redirect_stdout(io.StringIO()):
                parser.contracts(check_total=False)
                parser.grants(check_total=False)
                parser.canadabuys()
                parser.public_accounts()
            health = [r for r in out["fed_contracts.csv"] if r["procurement_id"] == "H105002096"]
            self.assertEqual(len(health), 1)
            self.assertEqual(health[0]["amount"], 255261335.35)
            self.assertEqual(len(json.loads(health[0]["amendment_history"])), len(CHAIN))
            self.assertEqual({r["supplier"] for r in out["canadabuys_nl.csv"]} & {"Adam Egan"}, set())
            files = {"fed_contract": "fed_contracts.csv", "fed_grant": "fed_grants.csv", "canadabuys": "canadabuys_nl.csv", "pa_pss": "pa_pss_nl.csv", "pa_tp": "pa_tp_nl.csv"}
            for id, status in EXPECTED.items():
                it = FIXTURES[id]["item"]
                if it["dataset"] == "fed_contract":
                    r = next(r for r in out[files[it["dataset"]]] if r["reference_number"] == json.loads(it["extra"])["reference_number"])
                elif it["dataset"] == "fed_grant":
                    r = next(r for r in out[files[it["dataset"]]] if r["ref_number"] == json.loads(it["extra"])["ref_number"])
                elif it["dataset"] == "canadabuys":
                    r = next(r for r in out[files[it["dataset"]]] if r["reference_number"] == FIXTURES[id]["raw"]["referenceNumber-numeroReference"])
                else:
                    field = "payee" if it["dataset"] == "pa_pss" else "recipient"
                    r = next(r for r in out[files[it["dataset"]]] if r[field].lower() == it["supplier"].lower())
                x = evidence(it, {**r, "source_fields": json.dumps(json.loads(r["source_fields"]))})
                self.assertEqual(x["scope_status"], status, id)
                self.assertTrue(x["inclusion_rule"]["locator"])
                self.assertIn(x["scope_review_state"], {"reviewed", "unreviewed"})
                if x["scope_review_state"] == "reviewed":
                    self.assertTrue(x["scope_evidence"])
                else:
                    self.assertIn("NL Ledger has not established", x["scope_statement"])
                    self.assertNotIn("No separately established", json.dumps(x["scope_evidence"]))
                self.assertTrue(x["amount_kind"])
                if id in {"b035ea02a4e3", "d677e0fe2faf"}:
                    self.assertTrue(x["location_conflict"])
                if id == "c5500509042d":
                    changed = {**json.loads(r["source_fields"]), "comments_en": "A changed project"}
                    with self.assertRaisesRegex(AssertionError, "location evidence changed"):
                        evidence(it, {**r, "source_fields": json.dumps(changed)})
            # The parser must not replace a published zero with its fallback amount.
            zero = {**notices[0], "totalContractValue-valeurTotaleContrat": "0", "contractAmount-montantContrat": "123"}
            csvfile(fed / "awardNoticeComplete.csv", [zero])
            with patch.object(parser, "FED", fed), patch.object(parser, "write", lambda name, rows: out.update({name: rows})), contextlib.redirect_stdout(io.StringIO()):
                parser.canadabuys()
            self.assertEqual(out["canadabuys_nl.csv"][0]["amount"], 0)


class FakeResponse:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, json.dumps(body)

    def json(self):
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")


class FakePortal:
    """The grants datastore as open.canada.ca serves it: 1,000 rows a page at most, and a daily
    reload that briefly removes the table (404) and renumbers every _id."""

    def __init__(self, rows, first_id=500):
        self.reload(rows, first_id)
        self.calls, self.down, self.on_call = [], 0, {}
        self.package = {"resources": [{"id": fetch_federal.GRANTS, "name": "grants", "datastore_active": True, "last_modified": "x"}]}

    def reload(self, rows, first_id):
        self.rows = [{"_id": first_id + i, "ref_number": f"r{i}"} for i in range(rows)]

    def get(self, url, params=None, timeout=None):
        if url == fetch_federal.PACKAGE:
            return FakeResponse(200, {"success": True, "result": self.package})
        self.calls.append(params)
        if len(self.calls) in self.on_call:
            self.on_call.pop(len(self.calls))(self)
        if self.down:
            self.down -= 1
            return FakeResponse(404, {"success": False, "error": {"__type": "Not Found Error"}})
        off, limit = int(params.get("offset", 0)), min(int(params["limit"]), 1000)
        return FakeResponse(200, {"success": True, "result": {"total": len(self.rows), "total_was_estimated": False,
                                                              "records": self.rows[off:off + limit]}})


class GrantsFetchTests(unittest.TestCase):
    def fetch(self, portal):
        waits = []
        with tempfile.TemporaryDirectory() as tmp, patch.object(fetch_federal, "_session", portal), \
                patch.object(fetch_federal, "CACHE", Path(tmp)), patch.object(fetch_federal, "cache_path", lambda p: p), \
                contextlib.redirect_stdout(io.StringIO()):
            m = {}
            fetch_federal.fetch_grants(m, sleep=waits.append)
            rows = [json.loads(line) for line in (Path(tmp) / "federal/grants_NL.jsonl").read_text().splitlines()]
        return rows, waits, m

    def test_pages_at_the_portal_cap_until_the_total(self):
        rows, waits, m = self.fetch(portal := FakePortal(2500))
        self.assertEqual([r["_id"] for r in rows], list(range(500, 3000)))
        pages = [c for c in portal.calls if c["limit"] == fetch_federal.PAGE]
        self.assertEqual([c["offset"] for c in pages], [0, 1000, 2000])
        self.assertTrue(all(c["sort"] == "_id" and json.loads(c["filters"]) == {"recipient_province": "NL"} for c in portal.calls))
        self.assertEqual(waits, [])
        self.assertIn("sha256", m["federal/grants_NL.jsonl"])

    def test_waits_out_a_reload_404(self):
        portal = FakePortal(2500)
        portal.on_call[3] = lambda p: setattr(p, "down", 2)  # the table is missing for the third page
        rows, waits, _ = self.fetch(portal)
        self.assertEqual(len(rows), 2500)
        self.assertEqual(waits, [30, 60])

    def test_restarts_when_the_table_is_reloaded_mid_fetch(self):
        portal = FakePortal(2500)
        # After the second page the table is renumbered and gains a row (the 2026-11-02 run).
        portal.on_call[3] = lambda p: p.reload(2501, first_id=90_000)
        rows, waits, _ = self.fetch(portal)
        self.assertEqual([r["_id"] for r in rows], list(range(90_000, 92_501)))
        self.assertIn(60, waits)  # waited for the reload to settle before starting again

    def test_fails_clearly_when_the_resource_is_gone(self):
        portal = FakePortal(10)
        portal.down = 10**6
        portal.package = {"resources": [{"id": "new-id", "name": "grants", "datastore_active": True}]}
        with self.assertRaisesRegex(RuntimeError, "no longer lists resource .*new-id"):
            self.fetch(portal)

    def test_gives_up_when_the_table_never_holds_still(self):
        portal = FakePortal(2500)
        ids = iter(range(10**5, 10**7, 10**4))
        portal.on_call = {n: (lambda p: p.reload(2500, next(ids))) for n in range(2, 400, 2)}
        with self.assertRaises(RuntimeError):
            self.fetch(portal)


def main():
    unittest.main(module=__name__, argv=["test_federal"], verbosity=2)


if __name__ == "__main__":
    main()
