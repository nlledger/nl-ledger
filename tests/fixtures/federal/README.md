# Federal amendment fixtures

`../cache/federal/` contains **22 grant rows and 15 contract rows** selected from
`data/cache/federal/` in the main checkout, with every publisher field retained.
Grant JSON lines are copied verbatim; contract CSV records retain their original
field values and header. No records were invented. Source order is retained,
including amendments that precede originals in the file.

`amendment-cases.json` records why each chain is included, its expected latest
reference and recipient, number of versions, exact value, publisher links, and
line numbers in the original cached file (CSV header is line 1; JSONL starts at
line 1). It also records the full cached files' SHA-256 hashes and the contracts
fetch time, 2026-09-29. Federal sources use the Open Government Licence – Canada.
The grants cache was selected by publisher-reported `recipient_province = NL`.

| Department / agreement or procurement | Rule checked | Rows | Retained value (CAD) |
|---|---|---:|---:|
| ACOA / 192588 | Latest running total, despite source order | 3 | 170,000.00 |
| ACOA / 211291 | Latest published zero, not original value | 3 | 0.00 |
| Agriculture / CASPP-105 | Renamed recipient is one agreement | 2 | 5,125,000.00 |
| Indigenous Services / 2526-AT-000027 | Original plus negative change | 2 | 400,000.00 |
| Crown-Indigenous Relations / 1819-HQ-000034 | Five changes, including a negative amendment | 5 | 3,531,937.00 |
| Canadian Heritage / 1337983 | Sum three changes, all numbered amendment 0 | 3 | 21,768,583.00 |
| Public Health Agency / 1718-HQ-000283 | Original plus extension change | 2 | 2,509,260.00 |
| Infrastructure / unnumbered, Grand Falls-Windsor | Reissued references still form one agreement | 2 | 15,384,361.00 |
| Agriculture / 3000733969 | Latest contract total, supplier punctuation variants | 3 | 105,281.53 |
| Health / H105002096 | Reviewed supplier rename; national service, NL address | 12 | 255,261,335.35 |

These files print **no reconciliation total**. Expected values are hand-traced
from each chain's published running totals or changes, not a claim that these
are payments or spending in NL. `../expected.json` pins the aggregate counts
and values: **8 agreements, CAD 48,889,141.00; 2 contracts, CAD 255,366,616.88**.
The raw grant values add to CAD 68,102,928.00. Fourteen contract rows have an NL
address and add to CAD 1,681,123,737.32 before deduplication. The fifteenth is an
earlier record in the reviewed Health Canada chain, without an NL postal code;
it stays as provenance, not an additional selected contract.

The national service is selected by its supplier's `A1N` postal prefix. The
existing source review says the service was made available nationally, with no
reported NL share. The check passes the parsed row through the same
`federal_evidence.evidence` function and record ID as the ledger builder, and
requires that broader scope, Canada delivery, NL address, review state,
selection field, source evidence and no-NL-share statement remain intact.

Run from `pipeline/`:

```sh
uv run python check_fixtures.py
```

The existing reconciliation CI job runs this command. It copies the fixtures
into a temporary `NL_LEDGER_DATA` directory, then runs the real `contracts` and
`grants` parsers through `check_federal_fixtures.py`. Only full-dataset volume
bounds are disabled. Negative-amendment guards, identities, grouping, sorting,
value rules and evidence reviews run normally. No fetch or main-cache write
occurs. Per-chain checks use decimal equality and run even with `--update`;
that option only updates aggregate expectations after these checks pass.

## Regression proof, 2026-10-01

Each temporary mutation below was applied independently in the isolated
worktree, followed by `uv run python check_fixtures.py`. Files were restored
in `finally` blocks; none of these mutations is part of the change.

| Mutation | Observed result |
|---|---|
| Replace grant groups before rename reconciliation with one unique `ref:` group per input row | Exit 1; all numbered agreement expectations fail, unnumbered agreement yields 2 records instead of 1 |
| Add `line_no` to each contract identity | Exit 1; Agriculture yields 3 records instead of 1, Health yields 11 selected records instead of 1 |
| Change the national contract's reviewed scope status to `NL` | Exit 1; expected `national_or_multiple_or_other`, parsed `NL` |

After restoration, the same command exits 0 with 8 agreements and 2 contracts.
The production parser and location reviews are unchanged.

The other files in this directory hold the earlier real-source audit
counterexamples used by `check_federal.py`; this amendment sample complements
those checks.
