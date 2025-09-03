# Agents and Architecture

This project computes total return for a brokerage portfolio (including dividends) from Fidelity CSV exports. It ships with two backend implementations (Python FastAPI and a Node.js Express rewrite) and a minimal static frontend.

The term "agents" below refers to the core components that parse data, aggregate portfolio state, fetch prices, and serve results.

## Overview

- Input: Fidelity CSVs for activity (transactions) and positions (holdings).
- Processing: Normalize symbols, classify actions, aggregate shares/cost/dividends, fetch current prices, compute market value and total return.
- Output: JSON payload consumed by a simple web UI.

Data uploads are transient. CSVs are deleted after calculation (or via an explicit clear endpoint in the Node backend).

## Components (Agents)

- Activity Ingestor: Parses activity CSVs, classifies buys/sells/dividends, aggregates invested cash deltas and dividend income.
  - Python: `app/portfolio.py:56` in `aggregate_activity`
  - Node: `node-app/portfolio.js:61` in `aggregateActivity`

- Positions Ingestor: Parses positions CSVs, sums base shares and cost basis per symbol across accounts.
  - Python: `app/portfolio.py:98` in `parse_positions`
  - Node: `node-app/portfolio.js:98` in `parsePositions`

- Portfolio Engine: Merges activity and positions into a per-symbol summary and computes portfolio-level totals.
  - Python: `app/portfolio.py:132` in `compute_portfolio_summary`
  - Node: `node-app/portfolio.js:131` in `computePortfolioSummary`

- Price Provider: Fetches current prices with caching to reduce API calls.
  - Python (Yahoo via `yfinance` download last close): `app/price_providers.py:1`, cache TTL 15 minutes, batch `yf.download`.
  - Node (Yahoo via `yahoo-finance2` quote): `node-app/priceProviders.js:1`, cache TTL 15 minutes, batch `quote`.

- API Server: Handles file upload, triggers computation, serves frontend.
  - Python (FastAPI): `app/main.py:1`
    - Endpoints: `/` (UI), `/upload`, `/upload_positions`, `/portfolio`
  - Node (Express): `node-app/index.js:1`
    - Endpoints: `/` (UI), `/upload`, `/upload_positions`, `/portfolio`, `/recalc` (alias), `/clear`

- Frontend: Static single-page UI to upload CSVs and view results.
  - HTML/JS: `frontend/index.html:1`

## Data Flow

1) User uploads activity CSV(s) to `/upload` and positions CSV(s) to `/upload_positions`.
2) Server reads CSVs, de-duplicates rows, normalizes symbols, and aggregates per-symbol metrics.
3) Server fetches current prices for all symbols (with in-memory cache) and computes:
   - `market_value = current_price * shares`
   - `market_gain_dollars = market_value - net_invested_cash`
   - `market_gain_percent = market_gain_dollars / net_invested_cash * 100` (if invested > 0)
   - `total_return_dollars = market_value + dividends_received - net_invested_cash`
   - `total_return_percent = total_return_dollars / net_invested_cash * 100` (if invested > 0)
4) Server responds with `rows[]`, `overall`, and `missing_prices[]`. Uploaded CSVs are then cleared.

Text diagram

Activity CSVs -> Activity Ingestor
Positions CSVs -> Positions Ingestor
Ingestors -> Portfolio Engine -> Price Provider -> Enriched Summary -> Frontend

## Symbol & Action Normalization

- Cash-like rows (e.g., SPAXX, FCASH, various money market descriptors) are ignored for symbol aggregation.
  - Python: `CASH_TICKERS` and `_is_cash_like` in `app/portfolio.py:16`
  - Node: `CASH_TICKERS` and `isCashLike` in `node-app/portfolio.js:10`

- Action detection (regex): buys, sells, reinvestments, and dividend receipts.
  - Python: `BUY_PAT`, `SELL_PAT`, `REINVEST_PAT`, `DIV_PAT` in `app/portfolio.py:9`
  - Node: constants near top of `node-app/portfolio.js:1`

- Symbol cleaning for price lookup:
  - Strips leading `$`, uppercases, maps `.` to `-` for Yahoo where applicable.
  - Python aliases are override-able via `ALIASES` in `app/price_providers.py:12`.

## Computation Model

- Positions are authoritative for shares. If cost basis in positions is missing or 0, engine falls back to activity net invested for that symbol.
- Positions are doctrine (both): both backends report only symbols present in the positions file. Activity-only symbols are ignored entirely (prevents stale/closed tickers appearing). If a positions row has zero/unknown cost basis, the engine falls back to activity net invested for that symbol.

Implementation notes

- Activity quantities use absolute values for share deltas (both Python and Node) to handle CSVs that encode sell quantities as negatives.
- Dividends are taken from explicit “DIVIDEND RECEIVED …” entries only.
 - Buy/sell cash amounts use absolute values for robustness to broker CSV sign conventions (buys = cash out; sells = proceeds in).

Row schema (server response)

{
  symbol: string,
  shares: number,
  net_invested_cash: number,
  dividends_received: number,
  current_price: number | null,
  market_value: number | null,
  market_gain_dollars: number | null,
  market_gain_percent: number | null,
  total_return_dollars: number | null,
  total_return_percent: number | null
}

Overall schema (server response)

{
  invested: number,
  dividends: number,
  market_value: number,
  market_gain_dollars: number,
  market_gain_percent: number | null,
  total_return_dollars: number,
  total_return_percent: number | null
}

## API

- POST `/upload`: multipart form `file` (activity CSV). Accepts multiple sequentially.
- POST `/upload_positions`: multipart form `file` (positions CSV). Accepts multiple sequentially.
- GET `/portfolio`: Computes and returns the enriched portfolio summary.
- GET `/recalc` (Node only): Alias of `/portfolio`.
- POST `/clear` (Node only): Removes uploaded CSVs without computing.

Notes

- Python backend deletes uploaded CSVs automatically after `/portfolio` returns; there is no `/clear` route.
- Frontend calls `/clear`; this works with Node, and will 404 on the Python server. It’s harmless but noisy; you can remove the button or add a matching endpoint if desired.

## Runtime & Storage

- Upload directories: `data/uploads` (activity) and `data/positions` (positions). Created on startup.
- Files are ephemeral: cleared on compute (both backends) and via `/clear` in Node.
- Price cache TTL: 15 minutes in-memory (per process). No persistence across restarts.

## Local Development

Python (FastAPI)

- Install and run via the bootstrap helper on Windows:
  - `run_python.bat:1`
- Manual steps:
  - Create venv, install `requirements.txt:1`
  - Launch: `uvicorn app.main:app --reload --port 8000`
  - UI: open `http://127.0.0.1:8000/`

Node.js (Express)

- One-liner runners:
  - Unix: `run.sh:1`
  - Windows: `run.bat:1`
- Manual steps:
  - `cd node-app && npm install && npm start`
  - UI: `http://127.0.0.1:8000/`

## Extending

- New price aliases: add to `ALIASES` in `app/price_providers.py:12` (Python) or adjust `cleanSymbol` in `node-app/priceProviders.js:5`.
- Alternative price sources: replace the Yahoo calls in the price provider; keep the same function signature.
- Additional action types: extend regex and classification logic in `app/portfolio.py:9` (Python) or `node-app/portfolio.js:1` (Node).
- Other brokers: add column candidates in `_get_col` (Python) or adjust CSV parsing heuristics (Node).
- Persist uploads: swap the in-memory/ephemeral model for durable storage and add auth if deploying beyond local use.

## Known Limitations

- Fidelity CSV variations: Python path uses `pandas.read_csv` directly; if the CSV contains preamble lines before the header, parsing may fail. The Node path trims to the detected header (`node-app/index.js:52`) and is more forgiving.
- Missing/illiquid tickers: Prices may be `null`; totals use `n/a` semantics in the UI for holdings with no price when shares > 0.
- Cost basis fidelity: Positions file is the source of truth. If that lacks cost basis, activity net invested is used as a fallback.
- No tests: The repo currently has no automated tests.

## Troubleshooting

- 400 “Upload both an activity CSV and a positions CSV first”: Ensure both uploads were accepted before clicking Recalculate.
- Frontend “/clear” error on Python server: Expected; either ignore, remove the button, or add a `/clear` endpoint to FastAPI mirroring Node’s.
- Price lookups fail or are rate-limited: Results may show `missing_prices`. Try again later; cache helps reduce repeated calls.

## Repo Map

- Python backend: `app/main.py:1`, `app/portfolio.py:1`, `app/price_providers.py:1`
- Node backend: `node-app/index.js:1`, `node-app/portfolio.js:1`, `node-app/priceProviders.js:1`
- Frontend UI: `frontend/index.html:1`
- Runners: `run.sh:1`, `run.bat:1`, `run_python.bat:1`, `bootstrap.py:1`
