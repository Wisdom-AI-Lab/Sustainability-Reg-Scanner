# Sustainability-Reg-Scanner
Scans sustainability framework and regulatory standards across jurisdictions to help clients know their obligations

## Run locally

Serve the repository over HTTP (opening `index.html` as a local file will not reliably allow JSON fetches):

```sh
python3 -m http.server 8000
```

Open http://localhost:8000. GitHub Pages can serve the same files without a build step.

## Data files

- `data1.json`: metadata, scanner events, spotlight and demonstration rule engine.
- `data2.json`: entity master and researched/unresearched rules.
- `data3.json`: the 26 included obligation records.

Keep all three beside `index.html`. The application loads them together and calculates displayed coverage totals from the included records: 44 entities and 20 decomposed rules. The full 154-row register mentioned in the source material is not included.

Scanner events with mutations update the demonstration determinations or deadlines. Other events only highlight affected entities for review; they do not change stored register verdicts. Reset restores the demonstration baseline. Changes are in memory and do not persist after reloading.

## Checks

Node.js 18 or later is required; no npm dependencies are needed:

```sh
node --test tests/scanner.test.cjs
```

The tests execute the application script using a minimal DOM and file-backed fetch. They cover startup failures, navigation output, filtering, sorting, rule updates, reset and register integrity. They are not browser layout tests.

## Limitations

This remains a curated demonstration, not an automated regulatory monitoring service or legal advice. Regulatory statements, dates, entity facts and simplified rule assumptions have not been independently verified by these code corrections. The engine starts at a demonstration baseline and is separate from the stored register. Validate all source material before using results in client work.
