# Contributing to NL Ledger

NL Ledger is built from public records, and anyone can help make it more accurate and more complete. No programming is needed for most of what helps. If you have never opened a pull request, an issue with a link and a sentence is a full contribution, and a maintainer will take it from there.

People who use an AI assistant to prepare a change are equally welcome. The same standard applies to every change: it links to its source and its totals match.

## Ways in

| You want to | Open |
|---|---|
| Add a source of public spending records | The **Add a source** issue form |
| Question how something is counted, flagged or worded | The **Challenge a method** issue form |
| Report a figure that does not match its source | The **Figure does not match its source** issue form |
| Ask for records that are not published anywhere | The **Request unpublished data** issue form |
| Say anything else, without a GitHub account | The box at the foot of any page on [nlledger.ca](https://nlledger.ca) |

All four are at [Issues, New issue](https://github.com/nlledger/nl-ledger/issues/new/choose). Sources already known but not yet loaded are in [`docs/wishlist.md`](docs/wishlist.md); check there first, and pick one up if it interests you.

## Where to start

To run the site on your machine, you need only [Node](https://nodejs.org) 22.13 or newer:

```sh
git clone https://github.com/nlledger/nl-ledger.git
cd nl-ledger
npm ci --prefix site
./dev.sh
```

Open <http://localhost:8787>. It loads a small sample of the records, so no download or account is involved. The [README](README.md#project-layout) maps the folders.

Starter issues, each with what to do, where in the code and how to tell it is done:

| Issue | What | Skills |
|---|---|---|
| [#10](https://github.com/nlledger/nl-ledger/issues/10) | Trace 20 random records back to their source documents | no code |
| [#15](https://github.com/nlledger/nl-ledger/issues/15) | Read the Methods pages as a newcomer and rewrite what is unclear | no code |
| [#11](https://github.com/nlledger/nl-ledger/issues/11) | Test the personal tax calculation against form NL428 | JavaScript |
| [#12](https://github.com/nlledger/nl-ledger/issues/12) | Add a federal grants fixture so counting each agreement once is checked in CI | Python |
| [#16](https://github.com/nlledger/nl-ledger/issues/16) | Smoke-test every MCP tool against the sample data in CI | JavaScript |
| [#13](https://github.com/nlledger/nl-ledger/issues/13) | Download a search or supplier's records as CSV | JavaScript |
| [#14](https://github.com/nlledger/nl-ledger/issues/14) | Run an accessibility check over the built pages and fix what it finds | HTML, CSS |

All of them are under the [`good first issue`](https://github.com/nlledger/nl-ledger/labels/good%20first%20issue) and [`help wanted`](https://github.com/nlledger/nl-ledger/labels/help%20wanted) labels. Comment on one to say you are taking it.

## Editing a page

Page markup lives in `site/src/components/*.astro` and the shared shell in `site/src/layouts/Layout.astro`. The matching `site/src/pages/*.mjs` files prepare data, calculations and metadata; Worker handlers in `site/routes/` use the same components.

- Import helpers in each component. Pass data as props; do not pass functions.
- Import and nest child components directly, such as `<ReceiptLink url={record.source_url} />`. Only JavaScript entry points use `renderAstro(Component, data)` with an imported component reference.
- Use `{record.description}` for source text. Astro escapes it. Keep HTML out of strings, arrays and JavaScript data; write rich content as Astro markup or slots.
- `set:html` is reserved for the imported `icon()` output. The check rejects other raw HTML and caps the existing icon sinks at 54. New number formatting returns plain text and uses normal expressions.
- Layout slots carry already-rendered page markup. The JSON-LD boundary escapes `<` and Unicode separators before placing serialized JSON in its script slot. Do not use these boundaries for imported source HTML.

`site/check-components.mjs`, called by `site/check.sh`, enforces these rules. `npm run format --prefix site` formats the Astro markup. To compare two frozen builds and their local Worker requests, follow [Rendering comparisons](site/scripts/compare/README.md).

## What a good contribution includes

- **A source link for every figure.** Each new record links to the file and the page or row it came from. A reader should reach the original in one click.
- **Totals that reconcile.** Where the source prints a total, the parsed lines add up to it. Where it prints none, say so and show another check, such as a row count per report or a hand-traced sample.
- **A plain description of what is counted.** Say what each row is (an award, a payment, a claim), which dates it uses, and what is left out.
- **The publisher's licence.** Note the terms the source is published under, so the README's licence section stays accurate.
- **Neutral wording.** The site states what the records say. It does not accuse. A pattern is a question people ask, with its method written down.

For a method challenge or a mismatch report, the same rule applies in reverse: link the source and the page on the site, and describe what differs.

## Checks on every pull request

Three checks run on each pull request (`.github/workflows/checks.yml`):

- **Guardrails.** `site/check.sh` scans the site code for the maintainer's name: the site presents the records, not the people who run it. Run after a local build, it also scans the built pages for that name, for an author meta tag and for accusation words such as "waste" or "corrupt" outside the quoted records. The first two fail the check; the third prints for a reviewer to judge. CI has no built pages, so it runs only the code scan.
- **Syntax.** Every script in `pipeline/` and every module in `site/` must parse.
- **Reconciliation on sample sources.** `pipeline/check_fixtures.py` parses one real file per source that prints its own totals (a minister's report, an MHA's detail and summary, a year of program spending with the same year's Estimates and the three consolidated statements of its Public Accounts, an employer's pay disclosure; kept in `tests/fixtures/`) and fails if any parsed figure does not add up to the printed total, or if a parser returns a different number of rows than before. A change that alters those counts on purpose updates `tests/fixtures/expected.json` with `uv run python check_fixtures.py --update` and says why. `pipeline/check_matching.py` runs in the same job: the supplier-matching cases (joins that must happen, false joins that once happened) and a check that the AI server's name keys match the pipeline's. `pipeline/check_awards.py` also runs there: it pins the two Microsoft source PDFs, reviewed award pairs and receipt preservation. See [the award review](docs/award-review.md) for the counting rule and complete pair audit.

To see your change on a running site, Install the build tools once with `npm ci --prefix site`, then `./dev.sh` from a fresh clone needs only Node 22.13 or newer. It loads a small sample of the records, so no download or account is involved (see the [README](README.md#run-it-locally)).

These checks cannot run the full pipeline. Doing so downloads every source, including federal files of several hundred megabytes, and takes minutes. So CI checks reconciliation on the sample sources only, and does not check the built pages. Run them yourself before opening a pull request that touches data or the site:

```sh
cd pipeline && ./run.sh        # fetch, parse, reconcile
cd ../site && node build.mjs && ./check.sh
```

`run.sh` rewrites `docs/reconciliation.md`. Include the updated file in the pull request, and describe any total that no longer matches its source. Setup details are in the [README](README.md#run-it-locally).

## Every pull request gets a review

A maintainer reviews every pull request, however small. The review looks at the source links, the reconciliation and the wording, and asks questions rather than rejecting. A change that needs more work stays open with a note on what would settle it.

## Making a change

1. Fork the repository and create a branch.
2. Make the change. For a new source, add its fetch and parse scripts in `pipeline/` and its entry in `docs/sources.md`.
3. Run the local steps above. `./dev.sh` is the quickest way to look at the result.
4. Open a pull request and fill in the template.

If you would rather not do these steps, open an issue with what you found and where. That is enough.

## Conduct

Keep discussion about the records and the method. Do not use issues to accuse named people; the site shows what the public records say and nothing more. Comments that do will be edited or removed.
