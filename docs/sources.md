# Data sources

Notes on each source NL Ledger uses or has looked at: where it lives, what it holds, and its quirks. Checked 2026-09-30. "Verified" means the page or file was fetched; "untested" means it came from search results or was blocked.

## Access notes

- open.canada.ca, gov.nl.ca and MERX reject curl's default user agent. A browser user agent works.
- Federal bulk CSVs redirect to an Azure blob URL (`curl -L`) and start with a byte-order mark.
- The federal datastore has no full-text search on tables over 100K rows and no `datastore_search_sql`. Only exact-match `filters` work. The site loads the bulk files into its own database.
- **Federal contracts and grants repeat the whole record on every amendment.** Contracts are grouped by procurement id and cleaned vendor name across departments, latest row kept; source-reviewed supplier-name changes join only with matching department, procurement, original start and value. Earlier printings stay as provenance; grants by (department, agreement number, recipient), latest amendment kept or amendments summed depending on how the department reports. Address-selected contracts: $11.9B as published, CAD 2,547,127,660.51 after grouping. An address selects a record; it does not locate work, benefits or spending. Location evidence and conflicts are preserved separately. Current figures are in `reconciliation.md`.
- opendata.gov.nl.ca has no API. Its 76 datasets mirror on open.canada.ca CKAN under organization `nl-tnl`. Most are from 2013-2017.

## Provincial

| Source | Location | Contents | Years | Format | Status |
|---|---|---|---|---|---|
| PPA contract awards (limited call, exceptions, emergency) | https://www.gov.nl.ca/ppa/tenders/awarded/ ; archives `/ppa/2022-contract-awards/` to `/2025-contract-awards/`, `/ppa/tenders/archive` | Public body, procurement type, Act clause (6(a)(v) only one source, 6(a)(iv) emergency), description, commodity, supplier, city, province, price ex-HST, contract number, award date, term | 2021 to 2026-08-31, fortnightly | PDF with text layer; `pdftotext -layout` wraps multi-line cells; "REVISED" issues duplicate a fortnight | Verified (one 2026 PDF read; listing floor untested) |
| MERX awarded solicitations | https://www.merx.com/govnl/solicitations/awarded-bids?selectedContent=BUYER | 4,381 awarded solicitations: title, organization, dates | Untested range | JS-driven HTML | Verified listing; award values, winners and scraping terms untested |
| Report on Program Expenditures and Revenues of the CRF | Index https://www.gov.nl.ca/exec/tbs/public-accounts/ ; FY2021-22 https://www.gov.nl.ca/exec/tbs/files/Report-on-the-Program-Expenditures-and-Revenues-of-the-CRF-WEB.pdf | Actual, amended and original estimates by department, program, subprogram, expense type (Salaries, Professional Services, Purchased Services, Grants and Subsidies, etc.). Statement of Budgetary Contribution: actuals beside original estimates, on the Estimates' modified cash basis, unaudited. No payees | FY2014-15 to 2024-25; FY2019-20 on loaded | PDF text. Quirks: a program code printed without its last period ("3.2.02 FIRE SUPPRESSION"); amounts printed on the line above their object (2019-20, Transportation and Works); 2020-21 prints a dash for one original Salaries estimate its program total includes; 2024-25 prints no detail for Labrador Affairs | Verified: 174 of 175 department totals match the summary statements |
| Budget Estimates | `https://www.gov.nl.ca/budget/<year>/reports-and-publications/` (2021 on; 2019 and 2020 link from the budget's home page); addresses in `ESTIMATES` in `pipeline/fetch_provincial.py` | Same structure as the CRF report, budgeted. Each department opens with a page that prints its name and a Program Funding Summary ("Total: Program Estimates", current and capital). To Budget 2023 the summary statements (Statement I, Summary of Cash Requirements) are in the same PDF | FY2019-20 to 2026-27 loaded | PDF text. Quirks: "01.Salaries" without a space; an object such as "10. Grants and Subsidies" printed with no amounts, its amounts on the lines under it; one page in each of the 2025-26 (PDF page 48) and 2026-27 (PDF page 148) files stores text as glyph numbers, 29 below each character's code, and pdftotext drops the brackets there | Verified: 248 of 248 department totals match the printed summaries |
| Budget, Statements and Schedules | `https://www.gov.nl.ca/budget/<year>/wp-content/uploads/.../Statements-and-Schedules-<year>.pdf`; addresses in `BUDGET_STATEMENTS` | From Budget 2024: the budget's consolidated statements on the accrual basis (operations, financial position: forecast deficit and net debt) and the cash statements that used to be in the Estimates | FY2024-25 to 2026-27 | PDF text | Verified |
| Consolidated Summary Financial Statements (Public Accounts) | https://www.gov.nl.ca/exec/tbs/public-accounts/ ; addresses in `PUBLIC_ACCOUNTS` | Audited summary statements: revenue, expense, annual surplus or deficit, net debt, each with an Original Budget column; net debt per capita in the discussion and analysis; Crown entities. No supplier or grant-recipient lists. The same PDF also holds unconsolidated statements for the Consolidated Revenue Fund alone (a different net debt), so statements are matched on "Consolidated Statement of" | FY2019-20 to 2024-25 loaded (published from FY2014-15) | PDF text, 5 to 21 MB each. Later years restate some earlier figures | Verified |
| Crown corporation financial statements | https://www.gov.nl.ca/exec/tbs/home/publications/public-accounts/2023-24/ | Audited statements for 35+ entities | 2015-16 to 2024-25 | PDF per entity | Verified |
| Compensation disclosure (sunshine list) | Hub https://www.gov.nl.ca/exec/tbs/home/publications/compensation-disclosure/ ; core 2025 https://www.gov.nl.ca/exec/tbs/files/2025-Compensation-Disclosure-List-CORE-GNL.xlsx | Name, department, title, base, overtime, bonus, severance, total. Over $100K, rounded to $100. About 29 files per year (core, NLHS, NL Hydro, MUN, NL Housing, etc.) | 2022 to 2025 | XLSX; RNC names replaced by IDs | Verified |
| Ministerial expense claims | https://www.gov.nl.ca/exec/cabinet/expenseclaims/ | Per minister: date, purpose, amount | Half-yearly, Dec 2008 to May 2026 | PDF text | Verified |
| MHA expense reports | https://www.assembly.nl.ca/Members/Expenses/ ; pattern `Reports/Apr20YY-Mar20YY/<Last><First>Det<YYYY-YY>.pdf` and `...Sum...` | Per member and category: date, document number, vendor, details, amount | 2020 onward | PDF text | Verified for sampled members; index is dynamic, path pattern untested for others |
| MHA compensation | https://www.assembly.nl.ca/Members/Compensation/ | Salaries and allowances per member | FY2009-10 to 2022-23 | PDF | Verified |
| Auditor General | https://www.ag.gov.nl.ca/reports/all-reports/ | Performance audits, special reports, follow-ups on recommendations; 126 PDFs | Untested range | PDF prose | Verified |
| ATIPP completed requests | https://atipp-search.gov.nl.ca/public/atipp/Search/ | Completed requests with released PDFs | Untested | Search form | Verified loads |
| Muskrat Falls Inquiry | https://www.muskratfallsinquiry.ca/exhibits/ | Exhibits, transcripts, final report | 2018-2020 | HTML, PDF | Verified |
| Open data fiscal series and grants | https://opendata.gov.nl.ca/ | Cash spending (Apr-Jun 2014, 2015), grants over $250K (2014-15), net debt, expenses, revenue, municipal operating grants (2013-14), CEEP funding | Mostly 2013-2017; fiscal series to 2023 | CSV, XLS | Verified |

## Federal

| Source | Location | Contents | NL slice | Status |
|---|---|---|---|---|
| Contracts over $10K | Datastore resource `fac950c0-00d5-4ec1-a4d3-9cbebf98a305`; bulk `https://open.canada.ca/data/dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b/resource/fac950c0-00d5-4ec1-a4d3-9cbebf98a305/download/contracts.csv` (642 MB); schema `open.canada.ca/data/recombinant-published-schema/contracts.json` | 41 fields: vendor, postal code, contract/original/amendment value, description, solicitation_procedure (TN = non-competitive), limited_tendering_reason, instrument_type (A = amendment), former_public_servant, ministers_office, department, dates | Vendor postal code starting "A": 8,532 contracts with latest reported values of CAD 2,547,127,660.51 (see `reconciliation.md`); non-competitive about $230M; 717 rows at 2x original or more. Thin before 2021 (legacy file separate) | Verified |
| Contracts $10K and under (aggregate) | Resource `2e9a82e2-bb18-4bff-a61e-59af3b429672` | Per department per year: counts and values, acquisition card transactions | No province | Verified |
| Grants and contributions | Resource `1d15a62f-5656-49ad-8c88-f40ce689d831`; bulk grants.csv 2.3 GB (page the API with `filters={"recipient_province":"NL"}`) | Recipient, city, postal code, federal riding, program, agreement value, dates, amendment number | 29,207 agreements, $8.43B counted once (see `reconciliation.md`) | Verified |
| Travel expenses | Resource `8282db2a-878f-475c-af10-ad56aa8fa72c` (73 MB) | Named official, purpose, destination, airfare, lodging, meals, total | 538 trips to St. John's (exact-match destination) | Verified |
| Hospitality | Resource `7b301f1a-2a7a-48bd-9ea9-e0ac4a5313ed` (28 MB) | Description, location, vendor, attendees, total | 5 in St. John's | Verified |
| Annual travel, hospitality, conferences | Resource `a811cac0-2a2a-4440-8a81-2994fc753171` | Department totals per year | None | Verified |
| Founded wrongdoing | Resource `84a77a58-6bce-4bfb-ad67-bbe452523b14` | 73 cases | None | Verified |
| Public Accounts Vol III, professional and special services | `https://donnees-data.tpsgc-pwgsc.gc.ca/ba1/idsps-dipss/idsps-dipss-2025.csv` | Payee, city and province (one text column, `Contractor-details_Details-entrepr_eng`, called `Proj-desc_eng` until October 2026), department, amount; $100K floor; FY2003 onward | FY2024-25: 79 NL rows, $126.8M | Verified |
| Public Accounts Vol III, transfer payments | `.../ba1/pt-tp/pt-tp-2025.csv` | Recipient, city, province, amount; $100K floor | FY2024-25: 650 NL rows | Verified |
| Major transfers by province | `.../ba1/ppt-mtp/ppt-mtp-2025.csv` | Per province per transfer type | NL 2024-25: OAS $1,569M, EI $1,228M, CHT $688M, CST $224M | Verified |
| GC InfoBase datasets | Package `a35cf382-690c-4221-a971-cf0fd189a46f` | Spending by program and year from 2010, FTEs, transfer programs | No province | Verified CSVs; API untested |
| CanadaBuys award notices | `https://canadabuys.canada.ca/opendata/pub/awardNoticeComplete-avisAttributionComplet.csv` (102 MB, daily, from 2022-08); legacy 2012-2022 file | Supplier province and postcode, regions of delivery, method, limited tendering reason, amount | Supplier in NL: 434; delivery in NL: 781 | Verified |
| CanadaBuys contract history, tender notices | `.../contractHistoryComplete-contratsOctroyesComplet.csv`, `.../tenderNoticeComplete-avisAppelOffresComplet.csv` | Amendments, tenders | Untested | Verified files exist |
| House of Commons members' expenditures | `https://www.ourcommons.ca/ProactiveDisclosure/en/members/<summaryId>/csv` (IDs on the members page) | Per MP per quarter: salaries, travel, hospitality, contracts; line items on HTML detail pages | All NL MPs | Verified |
| Senate expenses | `https://sencanada.ca/en/ProActive/Summary/Senators/Q20234` | Quarterly HTML | Untested | Untested export |
| Statistics Canada | 36-10-0450 (provincial revenue and expense), 10-10-0005 (by function), 11-10-0190 (income and tax by family), 11-10-0222 (household spending), 17-10-0005 (population), 18-10-0004 (CPI) | Denominators and context | NL 2024: revenue $10,198M, expenditure $10,630M, debt interest $987M | Verified |

## Municipal

| Source | Location | Contents | Format | Status |
|---|---|---|---|---|
| St. John's weekly payment vouchers | https://www.stjohns.ca/your-government/access-to-information-and-protection-of-privacy/proactive-disclosures/ | Every accounts-payable payment: vendor, description, amount; weekly totals | Image-only PDF (OCR needed; tesseract reads it cleanly), 2021 to 2026 | Verified |
| St. John's salaries, statements, election finance | Same page | Council and management pay, statements, 2025 candidate contributions | PDF | Verified |
| Paradise cheque register | https://www.paradise.ca/government-engage/cheque-register/ | Payment number, date, vendor, invoice, description, amount | Monthly PDF with text layer, 2023 onward | Verified |
| Mount Pearl, CBS, Gander, Corner Brook, Grand Falls-Windsor | Town budget pages | Budgets, statements, council pay. No payment registers found in a bounded search | PDF, HTML | Verified pages |

## Linking

| Source | Location | Contents | Access | Status |
|---|---|---|---|---|
| CRA charity T3010 | https://open.canada.ca/data/en/dataset/80c00cdb-1358-415c-bb8b-0de7f12675b8 | Identification, directors, financials (federal, provincial, municipal revenue), compensation; 1,131 NL charities | Bulk CSV per year | Verified |
| Elections NL contributions | https://www.elections.gov.nl.ca/resources/areports/ ; XLSX e.g. https://www.elections.gov.nl.ca/files/2022A-Contributions-All-Parties.xlsx | Donor name, city, party, amount, date (PDFs 2017-2025; XLSX 2016-2022 without dates) | Per party per year | Verified |
| Elections Canada contributions | https://www.elections.ca/fin/oda/od_cntrbtn_audt_e.zip (112 MB) | Federal contributions, 2004 onward, weekly | Bulk | Verified download; contents untested |
| NL lobbyist registry | https://cado.eservices.gov.nl.ca/Lobbyist/LobbyistSearch.aspx | Lobbyist, client, activity; covers provincial contracts and grants and the City of St. John's | Search form only | Verified |
| NL Registry of Companies | https://cado.eservices.gov.nl.ca/ | Company search | Form only, no bulk | Directors untested |
| Federal corporations | https://open.canada.ca/data/en/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2 | Number, BN, names, status, address; no director names | Bulk CSV daily; API needs sign-up | Verified CSV; API untested |
| Investigative Journalism Foundation | https://theijf.org/ | Donor and lobbying databases | Paid, no bulk | Licence untested |

## Geography and outcomes

| Source | Location | Use | Status |
|---|---|---|---|
| NL electoral districts (2015) | https://opendata.gov.nl.ca/public/opendata/page/?page-id=datasetdetails&id=361 | Spending by MHA district | Verified; currency untested |
| Municipalities and local service districts | https://opendata.gov.nl.ca/public/opendata/page/?page-id=datasetdetails&id=265 | Community on the map | Verified (2014) |
| Statistics Canada 2021 boundaries | `lcsd000a21a_e.zip`, `lfed000a21a_e.zip`, `lfsa000a21a_e.zip` | Communities, ridings, postal FSA | Verified |
| NL population by community | https://opendata.gov.nl.ca/public/opendata/page/?page-id=datasetdetails&id=70 | Per-capita figures, 2010-2020 | Verified |
| NL wait times | https://www.gov.nl.ca/hcs/wait-times/data/ | Health outcomes against spending | Verified; PDFs |
| CIHI health expenditure | https://www.cihi.ca/sites/default/files/document/nhex-2025-full-data-tables-en.zip | Health spending per capita by province | NL rows untested |
| Canada Spends | https://github.com/BuildCanada/CanadaSpends | MIT-licensed code, Public Accounts parsers, NL tax visualizer | Verified |
| Not found | | Ferry on-time data, road condition, school data, postal code to community | |

## Federal evidence and money rule (30 September 2026)

An address selects a record; it does not establish work, benefit or expenditure location. Every federal record keeps the selection field and locator, reported country/province/postal code/city, full bilingual delivery/comments/project narratives/coverage/expected results, separately cited geographic evidence and a conflict state. Programme purpose remains available as context; unreviewed prose stays unknown. Exact reviewed project decisions are guarded against changed source evidence in `pipeline/federal_location_reviews.json`.

CanadaBuys rejects known foreign countries and validates Canadian postal codes. Public Accounts professional-services selection tests the trailing place, not the company name; published NL abbreviations are accepted. Contradictory grant locations stay visible. Native amounts and currencies remain as published: foreign and unstated currencies are not converted, and missing amounts differ from zero. Published notice total zero stays zero; only an absent total uses the contract-amount fallback.

Supplier commitment summaries exclude Public Accounts payments and CanadaBuys notices by overlap policy, not by a proven record-level duplicate. Source/body summaries show notices separately; retained combined body values explicitly disclose overlap. Major transfers are separate geographically identified receipt context, not provincial expenditure or additional unique records. Federal records and mixed supplier summaries have no automatic provincial scaling. [Every moved total](federal-total-changes.csv); [source review and verification](federal-evidence-review.md).
