"""Federal records selected by reported supplier or recipient location.

Contracts over $10K: every amendment repeats the whole record, with contract_value
holding the running total. Rows are grouped by (procurement_id, cleaned vendor)
and only the latest is kept. Rows without a procurement_id fall back to their
reference_number, so they are never merged with another contract.

Grants and contributions: one row per agreement (see grants()). The latest amendment is kept
where a department reports running totals; amendments are summed where it reports changes
(CHANGE_REPORTING), until a department's restated total replaces them (TOTALS_FROM).

CanadaBuys award notices overlap the contracts disclosure (the same contract can
appear in both). Notices are excluded from supplier commitment summaries and shown
separately in source/body summaries; retained combined values disclose overlap.
"""
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from common import CACHE, CLEAN, entity_key, money, name_forms, norm_space
from federal_evidence import PSS_PAYEE_FIELD, is_nl_postal, notice_selected, pss_location

csv.field_size_limit(10**9)
FED = CACHE / "federal"
REPORT: dict = {}
CONTRACT_CHAINS = json.loads(Path(__file__).with_name("federal_contract_chains.json").read_text())

SOLICITATION = {
    "TC": "Competitive (traditional)", "TN": "Non-competitive", "OB": "Competitive (open bidding)",
    "ST": "Competitive (selective tendering)", "AC": "Advance contract award notice",
}
LTR = {  # limited_tendering_reason codes
    "00": "", "0": "",
    "05": "No response to bid solicitation", "20": "Limited: interchangeable parts",
    "21": "Limited: additional deliveries", "22": "Limited: prototype", "23": "Limited: commodity market",
    "24": "Limited: exceptionally advantageous", "25": "Limited: design contest",
    "30": "Limited: additional services", "71": "Exclusive rights", "72": "Only one supplier",
    "74": "Urgency", "81": "Below trade agreement threshold",
}


def contract_chain_review(row):
    """A name change joins a chain only with a recorded publisher review and four matching identity fields."""
    for review in CONTRACT_CHAINS:
        if (row["owner_org"] == review["department"] and row["procurement_id"].strip() == review["procurement_id"]
                and row["contract_period_start"] == review["start"] and money(row["original_value"]) == review["original_value"]
                and entity_key(row["vendor_name"]) in {entity_key(n) for n in review["supplier_names"]}):
            return review
    return None


def contract_identity(row):
    """Reviewed name changes only: never merge on procurement number alone."""
    pid = row["procurement_id"].strip()
    vendor = entity_key(row["vendor_name"])
    review = contract_chain_review(row)
    if review:
        return ("reviewed-chain", row["owner_org"], pid, row["contract_period_start"], money(row["original_value"]), entity_key(review["canonical_supplier"]))
    return (pid, vendor) if pid else ("ref", row["owner_org"], row["reference_number"])


def contracts(*, check_total=True) -> None:
    raw_rows = raw_value = 0.0
    groups: dict[tuple, dict] = {}
    with open(FED / "contracts.csv", encoding="utf-8-sig", newline="") as fh:
        for line_no, row in enumerate(csv.DictReader(fh), 2):
            key = contract_identity(row)
            selected = is_nl_postal(row["vendor_postal_code"]) and row["country_of_vendor"] in ("CA", "")
            if not selected and key[0] != "reviewed-chain":
                continue
            v = money(row["contract_value"]) or 0.0
            if selected:
                raw_rows += 1
                raw_value += v
            if re.search(r"\bcompany xyz\b|\btest vendor\b", row["vendor_name"], re.I):
                continue  # placeholder records left in the published file
            pid = row["procurement_id"].strip()
            # The same purchase order can be reported by two departments (Coast Guard work reported
            # by both Fisheries and Oceans and National Defence), and the same vendor is spelled
            # several ways across amendments. Key on the purchase order and the cleaned vendor name.
            row["_line"] = line_no
            prev = groups.get(key)
            provenance = (prev["_provenance"] if prev else []) + [{
                "supplier": row["vendor_name"], "reference_number": row["reference_number"],
                "department": row["owner_org"], "procurement_id": pid,
                "start": row["contract_period_start"], "original_value": money(row["original_value"]),
                "amount": money(row["contract_value"]), "csv_line": line_no,
                "source_url": f"https://search.open.canada.ca/contracts/record/{row['owner_org']},{row['reference_number']}",
            }]
            order = (row["reporting_period"], row["contract_date"], row["reference_number"])
            if prev is None or order >= prev["_order"]:
                row["_order"] = order
                row["_versions"] = (prev["_versions"] + 1) if prev else 1
                row["_provenance"] = provenance
                groups[key] = row
            else:
                prev["_versions"] += 1
                prev["_provenance"] = provenance
    out = []
    for row in groups.values():
        if not is_nl_postal(row["vendor_postal_code"]) or row["country_of_vendor"] not in ("CA", ""):
            continue  # provenance does not select an out-of-province latest record
        proc = row["solicitation_procedure"]
        # Non-competitive means the department coded the solicitation "TN". A limited
        # tendering reason on its own is reported separately, not counted here.
        noncomp = proc == "TN"
        out.append({
            "reference_number": row["reference_number"],
            "procurement_id": row["procurement_id"],
            "owner_org": row["owner_org"],
            "department": row["owner_org_title"].split("|")[0].strip(),
            "vendor": norm_space(row["vendor_name"]),
            "postal_code": row["vendor_postal_code"],
            "source_fields": json.dumps({k: v for k, v in row.items() if not k.startswith("_")}),
            "amendment_history": json.dumps(row["_provenance"]),
            "chain_review": json.dumps(contract_chain_review(row)) if contract_chain_review(row) else "",
            "description": norm_space(row["description_en"]),
            "comments": norm_space(row["comments_en"]),
            "contract_date": row["contract_date"],
            "start": row["contract_period_start"],
            "end": row["delivery_date"],
            "amount": money(row["contract_value"]),
            "original_value": money(row["original_value"]),
            "amendment_value": money(row["amendment_value"]),
            "solicitation": SOLICITATION.get(proc, proc),
            "limited_reason": LTR.get(row["limited_tendering_reason"].strip(), row["limited_tendering_reason"].strip()),
            "non_competitive": int(noncomp),
            "former_public_servant": row["former_public_servant"],
            "ministers_office": row["ministers_office"],
            "instrument_type": row["instrument_type"],
            "commodity_type": row["commodity_type"],
            "standing_offer": row["standing_offer_number"].strip(),
            "reporting_period": row["reporting_period"],
            "versions": row["_versions"],
            "csv_line": row["_line"],
            "source_url": f"https://search.open.canada.ca/contracts/record/{row['owner_org']},{row['reference_number']}",
        })
    write("fed_contracts.csv", out)
    tot = sum(r["amount"] or 0 for r in out)
    REPORT["contracts"] = {
        "raw_rows": int(raw_rows), "raw_value": round(raw_value, 2),
        "procurements": len(out), "dedup_value": round(tot, 2),
        "non_competitive_value": round(sum(r["amount"] or 0 for r in out if r["non_competitive"]), 2),
        "by_year": {y: round(v) for y, v in sorted(_by(out, lambda r: r["contract_date"][:4]).items())},
    }
    print("contracts", REPORT["contracts"])
    if check_total:
        assert 2.0e9 < tot < 4.0e9, f"selected contract values {tot:,.0f} outside expected range"


# Departments whose amendment rows carry the change in value, not the agreement's new total.
# The data dictionary asks for the total ("not the change in agreement value"); these four
# report changes anyway. The evidence is in their own rows (checked against the file of
# 2026-09-29); federal_report.json also sets each one's total beside what Public Accounts
# shows it paid NL recipients (PA_NAME), which the latest rows alone fall far short of.
CHANGE_REPORTING = {
    "isc-sac": "Negative amendment rows. Late amendments are noted \"Funding of $X actually awarded\", where X is the row's own value. "
               "The 2024-25 child and family services agreement with the province adds to $54,115,591 across four rows, "
               "the amount Public Accounts shows paid that year.",
    "aandc-aadnc": "Negative rows noted \"The total award value of $X reported in a previous quarter has been reduced by this Amendment\". "
                   "Late amendments are noted \"Funding of $X actually awarded\", where X is the row's own value.",
    "pch": "Every row is amendment 0 under a new reference number. The 2020-2024 official languages agreement with the province "
           "(1337983) has rows of $12.7M, $8.7M and $0.4M; their sum matches the $21.7M paid to the province in 2021-22 to 2023-24.",
    "phac-aspc": "Late amendments are noted \"Funding of $X actually awarded\", where X is the row's own value. Extensions add half "
                 "the original value (1718-HQ-000283: $1,672,840, then $836,420 when two years were added).",
}
PA_NAME = {  # as Public Accounts prints them; a department renamed in a later file needs its new name here
    "isc-sac": "Department of Indigenous Services",
    "aandc-aadnc": "Department of Crown-Indigenous Relations and Northern Affairs",
    "pch": "Department of Canadian Heritage",
    "phac-aspc": "Public Health Agency of Canada",
}
# From their 2026-27 first-quarter disclosure on, Indigenous Services and Crown-Indigenous
# Relations report each agreement's new total, as the data dictionary asks. The note "The total
# award value of $2,945,966.00 reported in a previous quarter has been reduced by this
# Amendment" (CIRNAC 2425-HQ-000020) now comes with $2,901,754, the reduced total, where every
# earlier quarter's row with that note carried the negative change; all 24 rows in that file are
# positive, seven of them below what the agreement's earlier rows add to. Each such row replaces
# the sum of the earlier rows of the same agreement and agreement type (grant or contribution).
TOTALS_FROM = {"isc-sac": (2026, 1), "aandc-aadnc": (2026, 1)}


def ref_quarter(r) -> tuple[int, int] | None:
    """Fiscal year and quarter in an Indigenous Services or CIRNAC reference number (1910-2026-2027-Qrt1-...)."""
    m = re.search(r"-(\d{4})-\d{4}-Qrt(\d)-", r["ref_number"])
    return (int(m[1]), int(m[2])) if m else None


def restates(r) -> bool:
    q, since = ref_quarter(r), TOTALS_FROM.get(r["owner_org"])
    return bool(q and since and q >= since)


def newest_total(rs):
    return max((r for r in rs if restates(r)), key=lambda r: (ref_quarter(r), r.get("amendment_date") or "", r["ref_number"]), default=None)


# Running-total departments say so in their notes: ACOA "the previous value was $X" (X is the
# prior row in 1,514 of 1,519 cases), Health Canada "The total agreement value previously
# disclosed has been updated", NRC "The total amended value is -$X" (the row is the original
# plus X), Industry Canada "value changed from X to Y".


def _norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").split("|")[0].lower())


def grants(*, check_total=True) -> None:
    """One row per agreement.

    Rows are grouped into agreements by department, agreement number and cleaned recipient
    name, then:
    - A recipient renamed on an amendment (a novation, a new legal name, a respelling) stays
      the same agreement, when the number has one original recipient. Rows under another
      name that differ in both program and start date are a different agreement that shares
      the number.
    - Rows without an agreement number are one agreement per reference number, except where
      a department re-reports an amendment under a new reference number (Infrastructure
      Canada, Veterans Affairs): those join on recipient, start date, program and title.
    Where the department reports running totals the latest amendment is the agreement's
    value; where it reports changes (CHANGE_REPORTING) the amendments are added up. Once such a
    department reports totals (TOTALS_FROM), its latest total for the agreement and agreement
    type replaces the earlier changes.
    """
    with open(FED / "grants_NL.jsonl") as fh:
        rows = [json.loads(line) for line in fh]
    raw_value = sum(money(r.get("agreement_value")) or 0 for r in rows)
    negative = {r["owner_org"] for r in rows if (money(r.get("agreement_value")) or 0) < 0}
    assert negative <= CHANGE_REPORTING.keys(), f"negative grant values from {sorted(negative - CHANGE_REPORTING.keys())}: check how they report amendments"
    changes = sorted(r["ref_number"] for r in rows if restates(r) and (money(r.get("agreement_value")) or 0) < 0)
    assert not changes, f"negative rows {changes[:5]} where TOTALS_FROM says the department reports totals: check how it reports amendments"

    def who(r):
        return entity_key(name_forms(r.get("recipient_legal_name") or r.get("recipient_operating_name"), bilingual=True)[0])

    def unnumbered(r):
        return (r["owner_org"], who(r), r.get("agreement_start_date"), _norm(r.get("prog_name_en")),
                re.sub(r"dba$", "", _norm(r.get("agreement_title_en"))))

    def amended(r):
        return int(r.get("amendment_number") or 0) > 0

    reissued = {unnumbered(r) for r in rows if not (r.get("agreement_number") or "").strip() and amended(r)}
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        agr = (r.get("agreement_number") or "").strip()
        if agr:
            groups[(r["owner_org"], agr, who(r))].append(r)
        elif unnumbered(r) in reissued:
            groups[(r["owner_org"], "", *unnumbered(r)[1:])].append(r)
        else:
            groups[(r["owner_org"], f"ref:{r['ref_number']}", who(r))].append(r)
    by_number = defaultdict(list)
    for k in groups:
        if k[1] and not k[1].startswith("ref:"):
            by_number[k[:2]].append(k)
    for keys in by_number.values():
        originals = [k for k in keys if any(not amended(r) for r in groups[k])]
        if len(keys) < 2 or len(originals) > 1:
            continue
        home = originals[0] if originals else keys[0]
        starts = {r.get("agreement_start_date") for r in groups[home]}
        progs = {_norm(r.get("prog_name_en"))[:15] for r in groups[home]}

        def same(r):  # a blank program matches any
            p = _norm(r.get("prog_name_en"))[:15]
            return r.get("agreement_start_date") in starts or p in progs or not p or "" in progs

        for k in keys:
            if k != home and any(same(r) for r in groups[k]):
                groups[home] += groups.pop(k)
    out = []
    # The change-reporting evidence uses only rows from before a department switched to totals:
    # what they add up to, and what they would come to if read as totals (latest row only).
    summed, latest_only = Counter(), Counter()
    for (org, agr, *_), rs in groups.items():
        rs.sort(key=lambda r: (int(r.get("amendment_number") or 0), r.get("amendment_date") or "", r["ref_number"]))
        last = rs[-1]
        changes = [r for r in rs if not restates(r)]
        summed[org] += sum(money(r.get("agreement_value")) or 0 for r in changes)
        latest_only[org] += (money(changes[-1].get("agreement_value")) or 0) if changes else 0
        if newest := newest_total(rs):
            value = 0
            for kind in {r.get("agreement_type") for r in rs}:
                part = [r for r in rs if r.get("agreement_type") == kind]
                total = newest_total(part)
                value += money(total.get("agreement_value")) if total else sum(money(r.get("agreement_value")) or 0 for r in part)
            last = newest
            how = f"restated total replaces earlier changes, {len(rs)} rows (department reports totals from 2026-27)"
        elif org in CHANGE_REPORTING:
            value = sum(money(r.get("agreement_value")) or 0 for r in rs)
            how = f"sum of {len(rs)} amendment rows (department reports changes)"
        else:
            value = money(last.get("agreement_value"))
            how = f"latest of {len(rs)} rows (department reports running totals)"
        out.append({
            "ref_number": last["ref_number"],
            "agreement_number": "" if agr.startswith("ref:") else agr,
            "amendment_number": int(last.get("amendment_number") or 0),
            "rows": len(rs), "how": how,
            "owner_org": org,
            "department": (last.get("owner_org_title") or "").split("|")[0].strip(),
            "recipient": norm_space(last.get("recipient_legal_name") or last.get("recipient_operating_name")),
            "business_number": next((r.get("recipient_business_number") for r in reversed(rs) if r.get("recipient_business_number")), "") or "",
            "postal_code": norm_space(last.get("recipient_postal_code")),
            "source_fields": json.dumps(last),
            "recipient_operating_name": norm_space(last.get("recipient_operating_name")),
            "recipient_type": last.get("recipient_type") or "",
            "city": norm_space(last.get("recipient_city")),
            "riding": last.get("federal_riding_name_en") or "",
            "program": norm_space(last.get("prog_name_en")),
            "title": norm_space(last.get("agreement_title_en")),
            "description": norm_space(last.get("description_en")),
            "agreement_type": last.get("agreement_type") or "",
            "amount": value,
            "start": min((r.get("agreement_start_date") or "")[:10] for r in rs),
            "end": (last.get("agreement_end_date") or "")[:10],
            "source_url": f"https://search.open.canada.ca/grants/record/{org},{last['ref_number']},current",
        })
    write("fed_grants.csv", out)
    tot = sum(r["amount"] or 0 for r in out)
    REPORT["grants"] = {"raw_rows": len(rows), "raw_value": round(raw_value, 2), "agreements": len(out), "dedup_value": round(tot, 2),
                        "delta_departments": sorted(CHANGE_REPORTING),
                        "change_reporting": {org: {"department": next(r["department"] for r in out if r["owner_org"] == org),
                                                   "evidence": ev, "summed": round(summed[org]),
                                                   "latest_only": round(latest_only[org])}
                                             for org, ev in CHANGE_REPORTING.items() if any(r["owner_org"] == org for r in out)},
                        "by_department": dict(Counter({k: round(v) for k, v in _by(out, lambda r: r["department"]).items()}).most_common(8))}
    print("grants", REPORT["grants"])
    if check_total:
        assert 5.0e9 < tot < 9.0e9, f"grants total {tot:,.0f} outside the expected range"


def currency_code(value: str) -> str:
    """Accept a three-letter uppercase code; the unmodified field stays in source_fields."""
    code = value.strip()
    return code if re.fullmatch(r"[A-Z]{3}", code) else "unstated"


def canadabuys() -> None:
    latest: dict[str, tuple[int, dict, int]] = {}
    with open(FED / "awardNoticeComplete.csv", encoding="utf-8-sig", newline="") as fh:
        for line_no, r in enumerate(csv.DictReader(fh), 2):
            prov = r["supplierAddressProvince-fournisseurAdresseProvince-eng"]
            pc = r["supplierAddressPostalCode-fournisseurAdresseCodePostal"]
            if not notice_selected(r):
                continue
            k = r["referenceNumber-numeroReference"] + "|" + r["supplierLegalName-nomLegalFournisseur-eng"]
            a = int(r["amendmentNumber-numeroModification"] or 0)
            if k not in latest or a >= latest[k][0]:
                latest[k] = (a, r, line_no)
    out = []
    for a, r, line_no in latest.values():
        out.append({
            "reference_number": r["referenceNumber-numeroReference"],
            "amendment_number": a,
            "title": norm_space(r["title-titre-eng"]),
            "solicitation_number": r["solicitationNumber-numeroSollicitation"],
            "contract_number": r["contractNumber-numeroContrat"],
            "award_date": r["contractAwardDate-dateAttributionContrat"][:10],
            "publication_date": r["publicationDate-datePublication"][:10],
            "amount": (money(r["totalContractValue-valeurTotaleContrat"]) if money(r["totalContractValue-valeurTotaleContrat"]) is not None else money(r["contractAmount-montantContrat"])),
            "currency": currency_code(r["contractCurrency-contratMonnaie"]),
            "province": r["supplierAddressProvince-fournisseurAdresseProvince-eng"],
            "country": r["supplierAddressCountry-fournisseurAdressePays-eng"],
            "postal_code": r["supplierAddressPostalCode-fournisseurAdresseCodePostal"],
            "delivery_regions": r["regionsOfDelivery-regionsLivraison-eng"],
            "start": r["contractStartDate-contratDateDebut"],
            "end": r["contractEndDate-dateFinContrat"],
            "source_fields": json.dumps({k: v for k, v in r.items() if not k.startswith(("contactInfo", "contractingEntityAddress", "endUserEntitiesAddress"))}),
            "supplier": norm_space(r["supplierLegalName-nomLegalFournisseur-eng"]),
            "city": norm_space(r["supplierAddressCity-fournisseurAdresseVille-eng"]),
            "buyer": norm_space(r["contractingEntityName-nomEntitContractante-eng"]),
            "method": r["procurementMethod-methodeApprovisionnement-eng"],
            "limited_reason": norm_space(r["limitedTenderingReason-raisonAppelOffresLimite-eng"]),
            "category": r["procurementCategory-categorieApprovisionnement"],
            "gsin": norm_space(r["gsinDescription-nibsDescription-eng"]),
            "csv_line": line_no,
            "source_url": (f"https://canadabuys.canada.ca/en/tender-opportunities/award-notice/{r['referenceNumber-numeroReference'].lower()}"
                           if ":" not in r["referenceNumber-numeroReference"] else
                           "https://open.canada.ca/data/en/dataset/a1acb126-9ce8-40a9-b889-5da2b1dd20cb"),
        })
    write("canadabuys_nl.csv", out)
    currencies = defaultdict(lambda: {"records": 0, "missing": 0, "value": 0})
    for r in out:
        cur = currencies[r["currency"]]
        cur["records"] += 1
        cur["missing"] += r["amount"] is None
        cur["value"] = round(cur["value"] + (r["amount"] or 0), 2)
    REPORT["canadabuys"] = {"notices": len(out), "value": currencies["CAD"]["value"], "by_currency": dict(currencies)}
    print("canadabuys", REPORT["canadabuys"])


PSS_COLUMNS = ["Fscl-yr_Ex-fin", "Dept-name_Nom-min_eng", "Rpt-obj_Art-rppt_eng", PSS_PAYEE_FIELD, "Aggregate-payments_Versements-totalisant"]
TP_COLUMNS = ["Fscl-yr_Ex-fin", "Dept-name_Nom-min_eng", "Rcpt-class_Cat-bnfcrs_eng", "Rcpt-nm-locn_Nm-lieu-bnfcrs_eng",
              "City_Ville_eng", "Prov-Terr_eng", "Aggregate-payments_Versements-totalisant"]
MTP_COLUMNS = ["Prov-Terr_eng", "Type-detail_eng", "Adjusts_Rajusts_eng", "Amt-units_Mnt-unite"]


def public_accounts_rows(name: str, required: list[str]):
    """Yield (csv line, row) from a Public Accounts file, first checking that every column read is in its header.

    The publisher has renamed columns between weekly runs, so a missing one stops the run naming the file and column."""
    with open(FED / name, encoding="utf-8-sig", newline="") as fh:
        rd = csv.DictReader(fh)
        header = rd.fieldnames or []
        for column in required:
            if column not in header:
                raise ValueError(f"{name}: column {column!r} is missing; the header is {header}")
        yield from enumerate(rd, 2)


def public_accounts() -> None:
    pss, tp, mtp = [], [], []
    for y in (2022, 2023, 2024, 2025):
        for line_no, r in public_accounts_rows(f"pss-{y}.csv", PSS_COLUMNS):
            parsed = pss_location(r[PSS_PAYEE_FIELD] or "")
            if not parsed:
                continue
            name, place = parsed
            pss.append({"fiscal_year": r["Fscl-yr_Ex-fin"], "department": r["Dept-name_Nom-min_eng"],
                        "category": r["Rpt-obj_Art-rppt_eng"], "payee": norm_space(name), "place": norm_space(place),
                        "amount": money(r["Aggregate-payments_Versements-totalisant"]),
                        "province": place.rsplit(",", 1)[-1].strip(), "source_fields": json.dumps(r),
                        "file": f"pss-{y}.csv", "csv_line": line_no})
        for line_no, r in public_accounts_rows(f"tp-{y}.csv", TP_COLUMNS):
            if r["Prov-Terr_eng"] != "Newfoundland and Labrador":
                continue
            tp.append({"fiscal_year": r["Fscl-yr_Ex-fin"], "department": r["Dept-name_Nom-min_eng"],
                       "program": norm_space(r["Rcpt-class_Cat-bnfcrs_eng"]), "recipient": norm_space(r["Rcpt-nm-locn_Nm-lieu-bnfcrs_eng"]),
                       "city": r["City_Ville_eng"], "amount": money(r["Aggregate-payments_Versements-totalisant"]),
                       "province": r["Prov-Terr_eng"], "source_fields": json.dumps(r),
                       "file": f"tp-{y}.csv", "csv_line": line_no})
        if not (FED / f"mtp-{y}.csv").exists():
            continue
        with open(FED / f"mtp-{y}.csv", encoding="utf-8-sig", newline="") as fh:
            header = csv.DictReader(fh).fieldnames or []
        ycol = next((c for c in header if re.fullmatch(r"\d{4}/\d{4}", c)), None)
        if ycol is None:
            raise ValueError(f"mtp-{y}.csv: no fiscal-year column such as '2024/2025'; the header is {header}")
        for line_no, r in public_accounts_rows(f"mtp-{y}.csv", MTP_COLUMNS):
            if r["Prov-Terr_eng"] != "Newfoundland and Labrador" or not r["Type-detail_eng"]:
                continue
            unit = 1_000_000 if "1000000" in r["Amt-units_Mnt-unite"] else 1
            mtp.append({"fiscal_year": ycol, "transfer": r["Type-detail_eng"], "adjust": r["Adjusts_Rajusts_eng"],
                        "amount": (money(r[ycol]) or 0) * unit, "file": f"mtp-{y}.csv", "csv_line": line_no})
    write("pa_pss_nl.csv", pss)
    write("pa_tp_nl.csv", tp)
    write("pa_mtp_nl.csv", mtp)
    REPORT["public_accounts"] = {
        "pss": {fy: round(v) for fy, v in _by(pss, lambda r: r["fiscal_year"]).items()},
        "tp": {fy: round(v) for fy, v in _by(tp, lambda r: r["fiscal_year"]).items()},
        "mtp_2024_25": {r["transfer"]: r["amount"] for r in mtp if r["fiscal_year"] == "2024/2025" and not r["adjust"]},
    }
    print("public accounts", json.dumps(REPORT["public_accounts"], indent=1)[:1500])


def _by(rows, keyf):
    d = defaultdict(float)
    for r in rows:
        d[keyf(r)] += r["amount"] or 0
    return d


def write(name: str, rows: list[dict]) -> None:
    if not rows:
        return
    with open(CLEAN / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    contracts()
    grants()
    canadabuys()
    public_accounts()
    tp = list(csv.DictReader(open(CLEAN / "pa_tp_nl.csv")))
    years = sorted({r["fiscal_year"] for r in tp})
    for org, c in REPORT["grants"]["change_reporting"].items():
        c["paid"] = round(sum(money(r["amount"]) or 0 for r in tp if r["department"] == PA_NAME[org]))
        c["paid_years"] = f"{years[0][:4]}-{years[0][7:]} to {years[-1][:4]}-{years[-1][7:]}"
    for org in ("isc-sac", "aandc-aadnc"):  # four years' payments alone exceed the latest rows read as totals
        c = REPORT["grants"]["change_reporting"][org]
        assert c["latest_only"] < c["paid"] < c["summed"], f"{org}: Public Accounts check no longer separates the two readings: {c}"
    (CLEAN / "federal_report.json").write_text(json.dumps(REPORT, indent=1))


if __name__ == "__main__":
    main()
