"""Selection is address evidence, never evidence of where funds were spent.

Only structured delivery fields and reviewed project evidence establish geography.
Unreviewed prose and generic programme descriptions remain available, not inferred.
"""
import json
import re
from pathlib import Path

NL = "NL"
BROADER = "national_or_multiple_or_other"
UNKNOWN = "unknown"
REVIEWS = json.loads(Path(__file__).with_name("federal_location_reviews.json").read_text())
TRANSFER_REVIEW = json.loads(Path(__file__).with_name("federal_transfer_review.json").read_text())
UNREVIEWED_STATEMENT = "NL Ledger has not established the work, benefit or jurisdiction from this record; source fields are available below"
CANADA = {"", "ca", "can", "canada"}
NL_PROVINCES = {"nl", "newfoundland and labrador", "newfoundland & labrador", "newfoundland & labr.", "terre-neuve-et-labrador"}
POSTAL = re.compile(r"[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z](?:\s?\d[ABCEGHJ-NPRSTV-Z]\d)?", re.I)
PSS_PAYEE_FIELD = "Contractor-details_Details-entrepr_eng"  # "Payee, City, Province"; named Proj-desc_eng until October 2026
OUTSIDE_CITIES = {"winnipeg", "regina", "toronto", "ottawa", "halifax", "vancouver", "calgary", "edmonton", "montreal", "montréal"}


def is_nl_postal(value):
    pc = (value or "").strip().upper()
    return bool(POSTAL.fullmatch(pc) and pc.startswith("A"))


def notice_selected(r):
    country = r.get("supplierAddressCountry-fournisseurAdressePays-eng", "").strip().lower()
    prov = r.get("supplierAddressProvince-fournisseurAdresseProvince-eng", "").strip().lower()
    pc = r.get("supplierAddressPostalCode-fournisseurAdresseCodePostal", "")
    return country in CANADA and (prov in NL_PROVINCES or is_nl_postal(pc))


def pss_location(value):
    # The province is the trailing component; commas in a legal name stay in the name.
    parts = (value or "").rsplit(",", 2)
    if len(parts) != 3 or parts[-1].strip().lower() not in NL_PROVINCES:
        return None
    return parts[0].strip(), ", ".join(p.strip() for p in parts[1:])


def location_conflict(location):
    country = (location.get("country") or "").strip().lower()
    pc = (location.get("postal_code") or "").strip()
    city = (location.get("city") or "").split("|")[0].strip().lower()
    reasons = []
    if country not in CANADA:
        reasons.append(f"reported country is {location['country']}")
    if pc and POSTAL.fullmatch(pc) and not is_nl_postal(pc):
        reasons.append(f"reported postal code {pc} is outside NL")
    elif pc and not POSTAL.fullmatch(pc):
        reasons.append(f"reported postal code {pc} is not a valid Canadian postal code")
    if city in OUTSIDE_CITIES:
        reasons.append(f"reported city is {location['city']}")
    province = (location.get("province") or "").strip().lower()
    if province and province not in NL_PROVINCES:
        reasons.append(f"reported province is {location['province']}")
    return "; ".join(reasons)


def evidence(it, r):
    """Return the shared contract, retaining the publisher's exact fields and locator."""
    ds = it["dataset"]
    fields = json.loads(r["source_fields"])
    if ds == "fed_contract":
        location = {"postal_code": r["postal_code"], "country": fields.get("country_of_vendor", ""), "province": "", "city": ""}
        field, value, reason = "vendor_postal_code", r["postal_code"], "Selected because the supplier lists an NL postal code"
        kind, counted = "Latest reported federal contract value", "latest running contract value after amendments"
    elif ds == "fed_grant":
        location = {k: fields.get("recipient_" + k, "") for k in ("country", "province", "city", "postal_code")}
        field, value, reason = "recipient_province", location["province"], "Selected because the publisher reports recipient province NL"
        kind, counted = "Reported federal agreement value", r["how"]
    elif ds == "canadabuys":
        location = {k: r.get(k, "") for k in ("country", "province", "city", "postal_code")}
        field = "supplierAddressProvince-fournisseurAdresseProvince-eng" if location["province"].lower() in NL_PROVINCES else "supplierAddressPostalCode-fournisseurAdresseCodePostal"
        value = location["province"] if "Province" in field else location["postal_code"]
        reason = "Selected because the supplier reports an NL province or Canadian NL postal code"
        kind, counted = "Reported federal award notice value", "latest notice amendment; may overlap contract disclosures"
    else:
        location = {"city": r.get("city", r.get("place", "")), "province": r.get("province", ""), "country": "", "postal_code": ""}
        field = f"{PSS_PAYEE_FIELD} (trailing location)" if ds == "pa_pss" else "Prov-Terr_eng"
        value = r.get("place", r.get("province", ""))
        reason = "Selected because the published payee location is NL" if ds == "pa_pss" else "Selected because the publisher reports recipient province Newfoundland and Labrador"
        kind, counted = "Reported federal payment", "annual payment as published; may overlap commitments and notices"
    cite = {"source_url": it["source_url"], "locator": it["locator"]}
    conflict = location_conflict(location)
    status, statement = UNKNOWN, UNREVIEWED_STATEMENT
    review_state = "unreviewed"
    ev = []
    geography = {"work_or_delivery": [], "beneficiary_or_jurisdiction": []}
    review = REVIEWS.get(it["id"].rsplit("-", 1)[-1])
    if review:
        # Fail closed when evidence changes: an old decision must not label a new narrative.
        assert all(" ".join(str(fields.get(k, "")).split()) == " ".join(str(v).split()) for k, v in review["fields"].items()), f"location evidence changed for {it['id']}; review it again"
        review_state = "reviewed"
        status, statement = review["status"], review["statement"]
        ev = [{"field": k, "value": v, **cite} for k, v in review["fields"].items()]
        ev += review.get("additional_evidence", [])
        geography[review.get("geography_kind", "work_or_delivery")] = review["places"]
    elif ds == "pa_tp" and not conflict and fields.get(TRANSFER_REVIEW["recipient_field"]) in TRANSFER_REVIEW["recipients"] and fields.get(TRANSFER_REVIEW["province_field"]) == TRANSFER_REVIEW["province"]:
        # Reviewed exact government-recipient identities establish receipt jurisdiction,
        # never work/benefit geography or subsequent expenditure. Withheld groups do not match.
        review_state = "reviewed"
        status, statement = NL, TRANSFER_REVIEW["statement"]
        ev = [{"field": k, "value": fields[k], **cite} for k in
              (TRANSFER_REVIEW["recipient_field"], TRANSFER_REVIEW["province_field"], "Rcpt-class_Cat-bnfcrs_eng")]
        geography["beneficiary_or_jurisdiction"] = [fields[TRANSFER_REVIEW["recipient_field"]]]
    elif ds == "canadabuys":
        regions = [v.strip().lstrip("*") for v in r.get("delivery_regions", "").splitlines() if v.strip()]
        local = {"Newfoundland and Labrador", "Terre-Neuve-et-Labrador"}
        # Unresolved named sites are not assumed to be local or outside NL.
        broader = {"Canada", "Ontario (except NCR)", "Quebec (except NCR)", "National Capital Region (NCR)", "Nova Scotia", "New Brunswick", "Prince Edward Island", "British Columbia", "Alberta", "Saskatchewan", "Manitoba", "Yukon", "Northwest Territories", "Nunavut Territory", "Ireland", "Prescott"}
        if regions and all(v in local for v in regions):
            status, statement = NL, "The source identifies delivery in NL"
        elif any(v in broader for v in regions):
            status, statement = BROADER, "The source identifies national, multiple-region or other delivery; no NL share is reported"
        if status != UNKNOWN:
            review_state = "reviewed"
        if regions:
            ev = [{"field": "regionsOfDelivery-regionsLivraison-eng", "value": r["delivery_regions"], **cite}]
            geography["work_or_delivery"] = regions
    elif ds == "fed_grant" and not conflict:
        coverage = (fields.get("coverage") or "").split("|")[0].strip().lower()
        if coverage in {"national", "nationale", "international", "canada"}:
            review_state = "reviewed"
            status, statement = BROADER, "The source reports national or international coverage; no NL share is reported"
            ev = [{"field": "coverage", "value": fields["coverage"], **cite}]
            geography["beneficiary_or_jurisdiction"] = [fields["coverage"]]
    if conflict:
        statement += "; the reported address fields conflict (" + conflict + ")"
    period = it.get("fiscal_year") if ds.startswith("pa_") else {"start": r.get("start", r.get("award_date", r.get("contract_date", ""))), "end": r.get("end", ""), "reported": r.get("reporting_period", r.get("publication_date", ""))}
    return {"inclusion_rule": {"field": field, "value": value, "statement": reason, **cite},
            "reported_location": location, "location_conflict": conflict or None,
            "scope_review_state": review_state, "scope_status": status, "scope_statement": statement + ".", "scope_evidence": ev,
            "source_geography": geography, "source_fields": fields,
            "amount_kind": kind, "how_counted": counted, "amount_period": period,
            "amount_coverage": "not stated" if it.get("amount") is None else "published zero" if it["amount"] == 0 else "published value"}
