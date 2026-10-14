# Reconciliation

Generated 2026-09-30 by `pipeline/reconcile.py` from `data/build/ledger.db`.


## Items loaded

| Dataset | Items | Total (CAD) |
|---|---:|---:|
| mha | 58,521 | $7,057,632.94 |
| sunshine | 34,493 | $4,406,623,501.22 |
| fed_grant | 29,207 | $8,430,775,591.69 |
| fed_contract | 8,532 | $2,547,127,660.51 |
| ppa | 6,328 | $1,372,054,508.65 |
| minister | 2,585 | $3,424,682.22 |
| pa_tp | 2,484 | $11,889,648,933.00 |
| canadabuys | 535 | $830,019,361.38 |
| pa_pss | 357 | $683,854,665.00 |

Only source-supported CAD values enter this column. Native currencies, missing values and published zeros remain separate. Address selection does not establish work, benefit or expenditure location.
- canadabuys: 1 records, 1 published amounts, native USD 473000.0; not converted or included in CAD totals.
- canadabuys: 13 records, 12 published amounts, native unstated 394250.0; not converted or included in CAD totals.
- ppa: 60 records, 0 published amounts, native USD None; not converted or included in CAD totals.
- ppa: 31 records, 0 published amounts, native text None; not converted or included in CAD totals.

## Provincial contract awards (PPA reports)

- Reports parsed: 154 PDFs listed on gov.nl.ca, 4 superseded by a REVISED issue, 150 used.
- Award rows: 6,363. Rows with a Canadian-dollar amount: 6,272.
- Rows priced only in US dollars (kept, not converted, not in totals): 60.
- Rows with a rate, range or prose instead of a price (kept, not in totals): 31.
- Rows with no award date printed: 115 (dated by report period end).
- The reports have no printed totals to reconcile against. Check instead: row counts per report are listed in `data/clean/ppa_awards.csv` and every row carries its page and table row.

Superseded issues (original dropped, revised kept):

- ppa/Contract-Award-Report-2025-10-01-To-2025-10-15.pdf (33 rows) replaced by ppa/Contract-Award-Report-2025-10-01-To-2025-10-15-Revised-1.pdf (33 rows)
- ppa/2025-Dec-01-15-Contract-Awards-Report.pdf (33 rows) replaced by ppa/2025-Dec-01-15-Contract-Awards-Report.REVISED.pdf (33 rows)
- ppa/2026-June-16-30-Contract-Awards-Report.pdf (92 rows) replaced by ppa/2026-June-16-30-Contract-Awards-Report.REVISED.pdf (92 rows)
- ppa/2026-August-1-15-Contract-Awards-Report.pdf (47 rows) replaced by ppa/2026-August-1-15-Contract-Awards-Report-REVISED.pdf (47 rows)

- 35 repeated printings counted once; all receipts remain on the counted records.
- Same-amount, matched-supplier pairs within 31 days: 318; each decision and both source rows are in `docs/award-pairs.csv`.
- Source review and counting rule: `docs/award-review.md`.

| Award year | As printed (CAD) | Counted once (CAD) |
|---|---:|---:|
| 2004 | $75,694.00 | $75,694.00 |
| 2019 | $214,930.00 | $214,930.00 |
| 2020 | $18,886,785.72 | $18,886,785.72 |
| 2021 | $121,168,507.55 | $120,068,341.53 |
| 2022 | $217,082,925.81 | $217,070,435.81 |
| 2023 | $272,573,768.82 | $272,419,340.07 |
| 2024 | $238,885,733.41 | $238,793,074.11 |
| 2025 | $260,901,967.17 | $260,550,090.23 |
| 2026 | $244,198,954.29 | $243,918,733.18 |
| 2027 | $28,259.00 | $28,259.00 |
| 2028 | $16,000.00 | $16,000.00 |
| 2035 | $12,825.00 | $12,825.00 |

## Ministerial expense claims

- Reports: 224 PDFs across 11 six-month periods (December 2020 to May 2026).
- Check: for every report, the parsed summary lines add up to the PDF's own printed Total line.
- Reports whose lines do not add to the PDF total: 0.
- Reports where the gov.nl.ca listing page shows a different total from the PDF (publisher discrepancy):
  - `ministers/ministerial-expense-claims-june-2025-november-2025/Paul-Pike-June-Nov-2025.pdf`: web page total $5,289.46 vs PDF total $15,289.46 (publisher discrepancy)
  - `ministers/ministerial-expense-claims-june-2023-november-2023/cabinet-expenseclaims-june23-nov23-loveless-e.pdf`: web page total $25,157.31 vs PDF total $23,157.31 (publisher discrepancy)

## MHA expense reports

- Detail lines: 58,521, total $7,057,632.94.
- Summary reports (spending by category): total $7,057,632.94.
- Detail total minus summary total: $0.00.
- Check: every category section's lines add up to its printed Period Activity. Sections that do not: 0.
- Annual reports that the House of Assembly links but that return a web page instead of a PDF: 8 (listed on the sources page).

## Compensation disclosure (sunshine list)

- Rows: 34,493 from 84 workbooks.
- Check: base + overtime + bonus + shift + retroactive + severance + other equals the published total within rounding ($100 per field). Rows outside that: 38.
- Workbooks listed on gov.nl.ca that return 404: 19.
  - 2022: 5,047 people
  - 2023: 3,030 people
  - 2024: 12,607 people
  - 2025: 13,809 people

## Federal contracts, grants and notices

- Contracts over $10K to suppliers with an NL postal code: 9,882 rows worth $11,888,299,441.12 as published.
- Each amendment repeats the whole contract. Grouped by procurement id and cleaned vendor name, with source-reviewed name changes resolved on department, procurement, original start/value before grouping. Earlier references remain as provenance. latest kept: 8,532 contracts worth $2,547,127,660.51. An earlier grouping by department and raw vendor name gave about $2.83B; it counted a purchase order twice when two departments reported it or the vendor was spelled two ways.
- Non-competitive (solicitation code TN): $210,910,392.52.
- Grants and contributions selected by reported recipient province NL (including labelled address conflicts): 35,876 rows worth $11,680,096,859.79. One value per agreement (department, agreement number, recipient; a renamed recipient stays in its agreement): latest amendment where the department reports running totals, amendments summed where it reports changes (aandc-aadnc, isc-sac, pch, phac-aspc) until the department's restated total replaces them (isc-sac and aandc-aadnc from 2026-27 Q1): 29,207 agreements worth $8,430,775,591.69. Agreement values can span several years.
- Check of the change-reporting departments against Public Accounts transfer payments to NL recipients (payments of $100K or more):
  - Indigenous Services Canada: rows added up $1,541,824,956.00; latest row only $124,374,148.00; paid 2021-22 to 2024-25 $933,170,991.00.
  - Crown-Indigenous Relations and Northern Affairs Canada: rows added up $1,170,954,066.00; latest row only $185,594,268.00; paid 2021-22 to 2024-25 $626,664,634.00.
  - Canadian Heritage: rows added up $184,247,430.00; latest row only $141,598,572.00; paid 2021-22 to 2024-25 $78,988,445.00.
  - Public Health Agency of Canada: rows added up $51,000,929.00; latest row only $29,635,590.00; paid 2021-22 to 2024-25 $33,515,044.00.
- CanadaBuys award notices selected by reported NL supplier province or Canadian NL postal code: 535 ($830,019,361.38 supported CAD values). Notices may overlap disclosures. Excluded from supplier commitment summaries; shown separately in source/body summaries. Retained combined body amounts disclose overlap. Published zero totals remain zero; missing totals alone use the contract-amount fallback.

Major federal transfers to NL, 2024-25 (Public Accounts, $ millions as published):

- Old age security benefits: $1,569,000,000.00
- Canada Health Transfer: $688,000,000.00
- Canada Social Transfer: $224,000,000.00
- Fiscal arrangements: $228,000,000.00
- Quebec Abatement: $0.00
- Employment Insurance and support measures: $1,228,000,000.00
- Children's benefits: $0.00
- COVID-19 income support for workers: $0.00
- Canada-wide Early Learning and Child Care: $0.00
- Other major transfers: $318,000,000.00

## Department and program spending

- Check: for each department and account (current, capital), gross expenditure summed from the parsed object lines equals the department's gross expenditure in the report's own summary statement (rounded to $000). 174 of 175 match.
- Check, Estimates: each department's program lines add to the "Total: Program Estimates" line of its Program Funding Summary, current and capital, to the dollar. 248 of 248 match (8 years of Estimates).
  - 2024-25 labrador affairs (CURRENT): summary $16,697,000.00, parsed nothing. The 2024-25 report prints Labrador Affairs detail pages with only a heading and '#MISSING'; the source has no lines to parse.
- 2019-20 actual: gross expenditure $8,214,258,993.00
- 2019-20 estimates: gross expenditure $8,654,325,200.00
- 2020-21 actual: gross expenditure $7,929,214,100.00
- 2020-21 estimates: gross expenditure $8,514,893,000.00
- 2021-22 actual: gross expenditure $8,880,154,489.00
- 2021-22 estimates: gross expenditure $9,102,803,400.00
- 2022-23 actual: gross expenditure $9,110,447,041.00
- 2022-23 estimates: gross expenditure $9,087,284,900.00
- 2023-24 actual: gross expenditure $9,571,838,311.00
- 2023-24 estimates: gross expenditure $9,912,038,000.00
- 2024-25 actual: gross expenditure $10,628,156,038.00
- 2024-25 estimates: gross expenditure $11,013,336,000.00
- 2025-26 estimates: gross expenditure $12,056,608,000.00
- 2026-27 estimates: gross expenditure $12,926,768,400.00

## Budget against actual, the deficit and net debt

Two bases, kept apart. Budgeted and spent are from the Estimates and the Report on the Program Expenditures and Revenues of the Consolidated Revenue Fund (modified cash, departments). The surplus or deficit and net debt are from the audited Public Accounts (accrual, all government bodies).

| Check | Holds |
|---|---:|
| Report: each printed subtotal of the Statement of Budgetary Contribution recomputed (net expenditure, cash requirement; actual and original estimates) | 48 of 48 |
| Report: the departments in the summary statements add to the statement's gross expenditure | 6 of 6 |
| Estimates: the departments' program lines add to the gross expenditure in the budget's Summary of Cash Requirements | 8 of 8 |
| The Report's Original Estimates column equals the budget's own Summary of Cash Requirements (revenue, gross expenditure, related revenue, cash requirement) | 36 of 36 |
| Department by department, the Original column the Report reprints equals the Estimates as tabled | 112 of 114 |
| Public Accounts: revenue less expense equals the printed surplus or deficit; liabilities less financial assets equals net debt; net debt agrees between two statements | 24 of 24 |
| The Public Accounts' Original Budget column equals the budget's own statements (from Budget 2024, when they were first published as Statements and Schedules) | 4 of 4 |

Checks that do not hold:

- 2020-21: Executive Council: the Original column the Report reprints equals the Estimates as tabled. $250,118,900.00 against $252,162,100.00. The 2020-21 report prints a dash for the original Salaries estimate of program 2.2.01 (PDF page 38), while that program's printed total includes it; the budgeted figure is the Estimates'.
- 2024-25: Labrador Affairs: the Original column the Report reprints equals the Estimates as tabled. Nothing against $18,124,300.00. The 2024-25 report prints no program detail for Labrador Affairs, so it reprints no Original figure; the budgeted figure is the Estimates'.

| Fiscal year | Budgeted (Estimates) | Spent (Report) | Surplus or (deficit), budget | Surplus or (deficit), actual | Net debt |
|---|---:|---:|---:|---:|---:|
| 2019-20 | $8,654,325,000 | $8,214,259,000 | $1,924,452,000 | $1,117,181,000 | $14,434,860,000 |
| 2020-21 | $8,514,893,000 | $7,929,214,000 | ($1,838,099,000) | ($1,491,821,000) | $16,016,181,000 |
| 2021-22 | $9,102,803,000 | $8,880,154,000 | ($825,473,000) | ($271,910,000) | $16,371,691,000 |
| 2022-23 | $9,087,285,000 | $9,110,447,000 | ($351,404,000) | $323,136,000 | $16,510,536,000 |
| 2023-24 | $9,912,038,000 | $9,571,840,000 | ($159,923,000) | ($458,974,000) | $17,666,520,000 |
| 2024-25 | $11,013,336,000 | $10,644,852,000 | ($151,949,000) | ($296,637,000) | $18,435,914,000 |
| 2025-26 | $12,056,609,000 | not yet published | ($371,754,000) | not yet published | not yet published |
| 2026-27 | $12,926,768,000 | not yet published | ($688,545,000) | not yet published | not yet published |
