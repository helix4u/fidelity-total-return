# Fidelity Total Return

Calculate portfolio total return, including dividends, from Fidelity CSV exports. Two backends are provided (Node.js and Python/FastAPI) that serve a shared minimal frontend.

## What’s Included

- Node.js backend (Express) under `node-app/` (forgiving CSV parsing, recommended for most users)
- Python backend (FastAPI) under `app/` (simple, minimal deps)
- Shared frontend at `frontend/index.html`

## Features

- Upload activity and positions CSV files (Fidelity exports)
- Aggregate transactions and positions into a per-symbol summary
- Price lookup via Yahoo Finance with ~15 min in‑memory cache
- Metrics: Market Value, Market Gain $/%, Dividends %, Total Return $/%
- Sortable table with sticky header and an in‑app legend of formulas

## Quick Start

Node.js (recommended)

- Windows: run `run.bat`
- macOS/Linux: run `run.sh`
- Or manual:
  - `cd node-app && npm install && npm start`

Python (FastAPI)

- Windows helper: `run_python.bat`
- Manual:
  - Create venv and `pip install -r requirements.txt`
  - Launch: `uvicorn app.main:app --reload --port 8000`

Open the app at http://127.0.0.1:8000/.

## CSV Guidance

- Export both “Activity & Orders” and “Positions” from Fidelity.
- Node path trims preamble lines and is forgiving of variations.
- Python path expects the header row to be at the top of the CSV.

## Calculation Rules

- Positions are doctrine: only symbols present in the positions file are reported.
- Shares come from positions; cost basis from positions. If cost basis is missing/0, fall back to activity net invested.
- Activity parsing is robust to negative signs in Quantity/Amount (uses absolute values for buy/sell math).
- Dividends are the positive amounts for “DIVIDEND RECEIVED …” in activity.

Formulas

- Market Value = current_price × shares
- Market Gain $ = market_value − invested (excludes dividends)
- Market Gain % = Market Gain $ ÷ invested × 100 (if invested > 0)
- Dividends % = dividends ÷ invested × 100 (if invested > 0)
- Total Return $ = market_value + dividends − invested
- Total Return % = Total Return $ ÷ invested × 100 (if invested > 0)

## API

Common endpoints (both backends)

- `POST /upload` – upload one or more activity CSV files (multipart `file`)
- `POST /upload_positions` – upload positions CSV files (multipart `file`)
- `GET /portfolio` – compute and return the enriched portfolio summary

Node‑only convenience

- `POST /clear` – remove uploaded CSVs without computing
- `GET /recalc` – alias of `/portfolio`

Python notes

- Uploaded CSVs are deleted automatically after `/portfolio` returns.

## Data Handling & Privacy

- Upload directories: `data/uploads` (activity) and `data/positions` (positions)
- Files are ephemeral and `.gitignore` excludes `data/` and `*.csv`
- No auth; intended for local use only

## Known Limitations

- Broker CSV variability; Node is more tolerant than Python
- Tickers without reliable quotes may show n/a; they’re excluded from price‑dependent metrics
- No persistence beyond the current run; price cache is in‑memory (~15 min)

## Troubleshooting

- “Upload both an activity CSV and a positions CSV first”: ensure both uploads succeeded before Recalculate
- Python + Clear button: `/clear` exists only on Node; in Python it’s harmless to click but will show an error toast
- Price rate limits: try again later; caching reduces repeated calls

## Support

If this project helps you, consider [supporting it on Ko‑fi](https://ko-fi.com/gille).
