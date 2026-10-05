"""Offline download confinement checks; all writes are in disposable data directories.

Run with `cd pipeline && uv run python check_downloads.py`. The network is replaced
with fixtures; no shared cache, archive service or government endpoint is touched.
"""
import contextlib
import io
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

# Set this before importing common (which prepares its data directories).
_IMPORT_DATA = tempfile.TemporaryDirectory(prefix="nl-download-import-")
os.environ["NL_LEDGER_DATA"] = _IMPORT_DATA.name
import common
import archive
import fetch_federal as federal
import fetch_municipal as municipal
import fetch_ppa as ppa
import fetch_provincial as provincial
import parse_municipal as municipal_parser
import stats

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "cache"
PDF = (FIXTURES / "mha/Apr2022-Mar2023/DavisBernardSum2022-23.pdf").read_bytes()
TRAVERSAL = "Reports/Apr2020-Mar2021/../../../../site/static/injected.pdf"
MEMBERS = 'href="../Expenses/test.htm">Test Member</a>\', district: \'Test District\'\n'


class Response:
    status_code = 200

    def __init__(self, body=PDF, records=None):
        self.body = body
        self.records = records or []

    def raise_for_status(self):
        pass

    def iter_content(self, size):
        yield self.body

    def json(self):
        return {"result": {"records": self.records}}


class Downloads(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="nl-download-check-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.cache = self.base / "data/cache"
        self.cache.mkdir(parents=True)
        for module in (common, archive, federal, municipal, ppa, provincial, stats, municipal_parser):
            p = patch.object(module, "CACHE", self.cache)
            p.start()
            self.addCleanup(p.stop)
        for name, file in (("MANIFEST", "manifest.json"), ("FAILURES", "_fetch_failures.json"),
                           ("GONE_TRIED", "_gone_tried.json")):
            p = patch.object(common, name, self.cache / file)
            p.start()
            self.addCleanup(p.stop)
        self.request = patch.object(common._session, "get", return_value=Response()).start()
        self.addCleanup(patch.stopall)

    def assert_rejected(self, callback):
        before = sorted(str(p.relative_to(self.base)) for p in self.base.rglob("*"))
        calls = self.request.call_count
        with self.assertRaises(ValueError):
            callback()
        self.assertEqual(self.request.call_count, calls, "unsafe destination reached the network")
        self.assertEqual(sorted(str(p.relative_to(self.base)) for p in self.base.rglob("*")), before,
                         "unsafe destination created a directory or file")

    def test_exact_review_traversal_before_fetch_or_mkdir(self):
        dest = self.cache / "mha" / TRAVERSAL.split("/", 1)[1]
        self.assert_rejected(lambda: common.fetch("https://example.test/report.pdf", dest, manifest={}))
        self.assertFalse((self.base / "site/static/injected.pdf").exists())

    def test_general_path_variants_all_cache_folders(self):
        folders = ("mha", "ministers", "sunshine", "ppa", "paradise", "stjohns", "federal",
                   "crf", "estimates", "budget", "public-accounts", "statcan")
        for folder in folders:
            for bad in ("../other/injected.pdf", "%2e%2e/other/injected.pdf", "%252e%252e/injected.pdf",
                        "%2finjected.pdf", "bad%5c..%5cinjected.pdf", "bad%00.pdf"):
                with self.subTest(folder=folder, bad=bad):
                    self.assert_rejected(lambda: common.fetch("https://example.test/a.pdf",
                                                              self.cache / folder / bad, manifest={}))
        self.assert_rejected(lambda: common.fetch("https://example.test/a.pdf", self.base / "outside.pdf", manifest={}))

    def test_symlink_folders_files_and_partial_files(self):
        outside = self.base / "outside"
        outside.mkdir()
        sentinel = outside / "sentinel.pdf"
        sentinel.write_bytes(b"KEEP")
        for folder in ("mha", "ministers", "sunshine", "ppa", "paradise", "stjohns", "federal",
                       "crf", "estimates", "budget", "public-accounts", "statcan"):
            link = self.cache / folder
            link.symlink_to(outside, target_is_directory=True)
            self.assert_rejected(lambda: common.fetch("https://example.test/a.pdf", link / "new.pdf", manifest={}))
            link.unlink()
        for suffix in ("", ".part"):
            dest = self.cache / "report.pdf"
            link = Path(str(dest) + suffix)
            link.symlink_to(sentinel)
            self.assert_rejected(lambda: common.fetch("https://example.test/a.pdf", dest, manifest={}))
            link.unlink()
        self.assertEqual(sentinel.read_bytes(), b"KEEP")

    def test_gone_link_retried_monthly_without_notes(self):
        url = "https://example.test/gone.pdf"
        dest = self.cache / "mha/gone.pdf"
        with patch.object(common, "GONE", {url}):
            self.request.return_value = Response(b"<!DOCTYPE html><html>not found</html>")
            self.assertIsNone(common.fetch(url, dest, manifest={}))
            self.assertIsNone(common.fetch(url, dest, manifest={}))
            self.assertEqual(self.request.call_count, 1, "a GONE link was tried twice within the retry period")
            self.assertFalse((self.cache / "_fetch_failures.json").exists(), "a GONE link was recorded as a failure")
            tried = self.cache / "_gone_tried.json"
            tried.write_text(json.dumps({url: "2000-01-01T00:00:00+00:00"}))
            self.request.return_value = Response()
            manifest = {}
            self.assertEqual(common.fetch(url, dest, manifest=manifest), dest)
            self.assertEqual(dest.read_bytes(), PDF)
            self.assertIn("mha/gone.pdf", manifest)
            self.assertEqual(common.fetch(url, dest, manifest=manifest), dest)
            self.assertEqual(self.request.call_count, 2, "a fetched GONE link was not served from the cache")

    def mha_listing(self, href):
        return patch.object(provincial, "get_text", side_effect=[MEMBERS, f'<a href="{href}">report</a>'])

    def test_mha_rejects_decoded_absolute_extra_and_cross_source_paths(self):
        for bad in (TRAVERSAL, "Reports/Apr2022-Mar2023/%2e%2e/other.pdf",
                    "Reports/Apr2022-Mar2023/%252e%252e/other.pdf",
                    "Reports/Apr2022-Mar2023/extra/report.pdf",
                    "Reports/Apr2022-Mar2023/%2freport.pdf",
                    "/Reports/Apr2022-Mar2023/report.pdf", "https://evil.test/Reports/Apr2022-Mar2023/report.pdf",
                    "Reports/Apr2022-Mar2029/report.pdf"):
            with self.subTest(href=bad), self.mha_listing(bad):
                self.assert_rejected(lambda: provincial.mhas({}))

    def test_valid_reports_each_fetcher_and_cache_hits(self):
        # Use real PDF/XLSX fixtures and correctly formed CSV, ZIP and API records.
        zip_bytes = io.BytesIO()
        with zipfile.ZipFile(zip_bytes, "w") as z:
            z.writestr("14100064.csv", "VALUE\n123\n")
        pages = iter([[{"recipient_province": "NL", "value": "123.45"}], []])

        def publisher(url, **kwargs):
            if "datastore_search" in url:
                return Response(records=next(pages))
            if url.endswith(".xlsx"):
                return Response((FIXTURES / "sunshine/The-Rooms-Compensation-Disclosure-2022.xlsx").read_bytes())
            if url.endswith(".csv"):
                return Response(b"supplier,value\nFixture,123.45\n")
            if url.endswith(".zip"):
                return Response(zip_bytes.getvalue())
            return Response()

        self.request.side_effect = publisher
        m = {}
        annual = "Reports/Apr2022-Mar2023/DavisBernardSum2022-23.pdf"
        with patch.object(provincial, "get_text", side_effect=[MEMBERS,
                f'<a href="{annual}">annual</a>'
                '<a href="Reports/Apr2022-Sept2022/DavisBernardSumSept2022.pdf">half-year</a>'
                '<a href="Reports/Apr2019-Mar2020/DavisBernardSum2019-20.pdf">old</a>']):
            provincial.mhas(m)
        self.assertEqual(list(m), ["mha/Apr2022-Mar2023/DavisBernardSum2022-23.pdf"])
        period = "https://www.gov.nl.ca/exec/expenseclaims/dec20may21/"
        with patch.object(provincial, "get_text", side_effect=[f'<a href="{period}">Period</a>',
                '<title>Expenses | NL</title><tr><td><a href="https://www.gov.nl.ca/exec/files/Minister.pdf">Minister</a></td></tr>']):
            provincial.ministers(m)
        with patch.object(provincial, "get_text", return_value='<a href="https://www.gov.nl.ca/exec/files/Employer.xlsx">Pay</a>'):
            provincial.sunshine(m)
        with patch.object(ppa, "PAGES", ["https://example.test/ppa"]), patch.object(ppa, "get_text", return_value='<a href="https://www.gov.nl.ca/ppa/files/Awards.pdf">Awards</a>'):
            ppa.main()
        with patch.object(municipal, "get_text", return_value='<a href="/uploads/register.pdf">Register</a>'):
            municipal.paradise(m)
        with patch.object(municipal, "get_text", return_value='<a href="/uploads/payment.pdf">Payment</a>'):
            municipal.stjohns(m)
        with patch.object(provincial, "CRF_REPORTS", {"2023-24": "https://example.test/crf.pdf"}), patch.object(provincial, "ESTIMATES", {"2023-24": "https://example.test/estimates.pdf"}), patch.object(provincial, "BUDGET_STATEMENTS", {"2023-24": "https://example.test/budget.pdf"}), patch.object(provincial, "PUBLIC_ACCOUNTS", {"2023-24": "https://example.test/accounts.pdf"}):
            provincial.programs(m)
        with patch.object(federal, "BULK", {"federal/contracts.csv": "https://example.test/contracts.csv"}):
            federal.main()
        common.fetch("https://example.test/table.zip", self.cache / "statcan/14100064.zip", manifest=m)
        self.assertEqual(list(stats.read_csv("14100064")), [{"VALUE": "123"}])
        grants = [json.loads(line) for line in (self.cache / "federal/grants_NL.jsonl").read_text().splitlines()]
        self.assertEqual(grants, [{"recipient_province": "NL", "value": "123.45"}])
        for folder in ("mha", "ministers", "sunshine", "ppa", "paradise", "stjohns", "federal", "crf", "estimates", "budget", "public-accounts", "statcan"):
            self.assertTrue(any(p.is_file() for p in (self.cache / folder).rglob("*")), folder)
        dest = self.cache / "mha/Apr2022-Mar2023/DavisBernardSum2022-23.pdf"
        self.assertEqual(dest.read_bytes(), PDF)
        self.request.reset_mock()
        self.assertEqual(common.fetch("https://example.test/report.pdf", dest, manifest=m), dest)
        self.request.assert_not_called()

    def test_direct_grants_and_sidecars_reject_symlinks(self):
        outside = self.base / "outside"
        outside.mkdir()
        (self.cache / "federal").symlink_to(outside, target_is_directory=True)
        self.assert_rejected(lambda: federal.fetch_grants({}))
        for source, callback in (("ministers", provincial.ministers), ("sunshine", provincial.sunshine),
                                 ("mha", provincial.mhas), ("paradise", municipal.paradise), ("stjohns", municipal.stjohns)):
            (self.cache / source).symlink_to(outside, target_is_directory=True)
            with patch.object(provincial, "get_text", return_value=""), patch.object(municipal, "get_text", return_value=""):
                self.assert_rejected(lambda: callback({}))
        (self.cache / "ppa").symlink_to(outside, target_is_directory=True)
        with patch.object(ppa, "get_text", return_value=""):
            self.assert_rejected(ppa.main)

    def test_archive_rejects_manifest_traversal_before_any_file_read(self):
        outside = self.base / "outside.pdf"
        outside.write_bytes(PDF)
        for rel in ("../../outside.pdf", str(outside), "%2e%2e/outside.pdf"):
            with patch.object(archive, "client", return_value=(object(), "offline")), patch.object(archive, "archived", return_value={}), patch.object(archive, "load_manifest", return_value={rel: {}}), patch.object(archive, "sha256") as digest:
                with self.assertRaises(ValueError):
                    archive.upload()
                digest.assert_not_called()
        (self.cache / "mha").symlink_to(self.base, target_is_directory=True)
        with patch.object(archive, "client", return_value=(object(), "offline")), patch.object(archive, "archived", return_value={}), patch.object(archive, "load_manifest", return_value={"mha/outside.pdf": {}}), patch.object(archive, "sha256") as digest:
            with self.assertRaises(ValueError):
                archive.upload()
            digest.assert_not_called()

    def test_cache_control_files_and_root_reject_symlinks(self):
        target = self.base / "outside.json"
        target.write_text("[]")
        for name, callback in (("manifest.json", common.load_manifest),
                               ("manifest.json", lambda: common.save_manifest({})),
                               ("manifest.json", lambda: common.fetch("https://example.test/a.pdf", self.cache / "new/report.pdf")),
                               ("_fetch_failures.json", lambda: common.fetch("https://example.test/a.pdf", self.cache / "new/report.pdf", manifest={})),
                               ("_fetch_failures.json", lambda: common.record_failure("https://example.test/a.pdf", self.cache / "report.pdf", "404"))):
            link = self.cache / name
            link.symlink_to(target)
            self.assert_rejected(callback)
            link.unlink()
        outside = self.base / "other-cache"
        outside.mkdir()
        self.cache.rmdir()
        self.cache.symlink_to(outside, target_is_directory=True)
        self.assert_rejected(lambda: common.fetch("https://example.test/report.pdf", self.cache / "report.pdf", manifest={}))

    def test_municipal_ocr_rejects_symlink_work_pdf_text_and_image(self):
        source = self.cache / "stjohns"
        source.mkdir()
        pdf = source / "weekly-payment-vouchers-january-14-september-2-2026.pdf"
        pdf.write_bytes(PDF)
        work = source / "_ocr"
        outside = self.base / "outside-ocr"
        outside.mkdir()
        sentinel = outside / "sentinel"
        sentinel.write_text("KEEP")

        def dummy_ocr(args, **kwargs):
            if args[0] == "pdftoppm":
                Path(str(args[-1]) + "-01.png").write_bytes(b"small dummy image")
            return type("Done", (), {"stdout": "SUPPLIER 123.45\n"})()

        with patch.object(municipal_parser.subprocess, "run", side_effect=dummy_ocr) as process, patch.object(municipal_parser, "write"):
            work.symlink_to(outside, target_is_directory=True)
            self.assert_rejected(lambda: municipal_parser.stjohns({}, pages_per_file=1))
            process.assert_not_called()
            work.unlink()
            work.mkdir()
            for extension in (".txt", "-01.png"):
                link = work / (pdf.stem + "-p1" + extension)
                link.symlink_to(sentinel)
                self.assert_rejected(lambda: municipal_parser.stjohns({}, pages_per_file=1))
                process.assert_not_called()
                link.unlink()
            pdf.unlink()
            pdf.symlink_to(sentinel)
            self.assert_rejected(lambda: municipal_parser.stjohns({}, pages_per_file=1))
            process.assert_not_called()
            pdf.unlink()
            pdf.write_bytes(PDF)
            municipal_parser.stjohns({}, pages_per_file=1)
            self.assertEqual(process.call_count, 2)
            self.assertEqual((work / (pdf.stem + "-p1.txt")).read_text(), "SUPPLIER 123.45\n")
            self.assertFalse(any(work.glob("*.png")))
            process.reset_mock()
            municipal_parser.stjohns({}, pages_per_file=1)
            process.assert_not_called()
        self.assertEqual(sentinel.read_text(), "KEEP")

    def test_statcan_extraction_rejects_symlink_cache(self):
        directory = self.cache / "statcan"
        directory.mkdir()
        with zipfile.ZipFile(directory / "14100064.zip", "w") as z:
            z.writestr("14100064.csv", "VALUE\n123\n")
        target = self.base / "outside.csv"
        target.write_text("KEEP")
        (directory / "14100064.csv").symlink_to(target)
        self.assert_rejected(lambda: list(stats.read_csv("14100064")))
        self.assertEqual(target.read_text(), "KEEP")


if __name__ == "__main__":
    # Fetchers normally print progress; keep fixture output concise.
    with contextlib.redirect_stdout(io.StringIO()):
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Downloads))
    _IMPORT_DATA.cleanup()
    raise SystemExit(not result.wasSuccessful())
