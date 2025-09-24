# Agents and Architecture (Node Only)

This project computes total return for a brokerage portfolio (including dividends) from Fidelity CSV exports using a Node.js Express backend and a static frontend.

## Overview

- Input: Fidelity CSVs for activity (transactions) and positions (holdings).
- Processing: Normalize symbols, classify actions, aggregate shares/cost/dividends, fetch historical & current prices, compute market value and total return metrics.
- Output: JSON payload consumed by the frontend (tables, charts, CSV export).

Uploads are transient. CSVs are deleted after each calculation (or via ).


## Core Components

- Activity Ingestor: node-app/portfolio.js
- Positions Ingestor: node-app/portfolio.js
- Portfolio Engine: node-app/performance.js
- Price Provider: node-app/priceProviders.js
- API Server: node-app/index.js
- Frontend: frontend/index.html

## Data Flow

Activity CSVs -> Activity Ingestor -> Portfolio Engine
Positions CSVs -> Positions Ingestor -> Portfolio Engine
Portfolio Engine -> Price Provider -> Enriched Summary -> Frontend

## Computation Model

- Positions dictate share counts; missing cost basis falls back to activity net invested.
- Unitization produces a daily NAV timeline; TWR chains those periods to remove cash-flow timing.
- IRR solves for the money-weighted return across external cash flows plus current value.
- Dividend events capture shares held on payout to avoid overstating returns after sales.
- ROC flags fire when dividends are large relative to invested cash while price is underwater.
- Exposure tags highlight overlapping holdings (e.g., multiple S&P 500 ETFs).

## API Endpoints

- POST /upload
- POST /upload_positions
- GET /portfolio
- GET /recalc
- POST /clear

## Runtime & Storage

- Upload directories: data/uploads & data/positions (created on start, cleared after compute).
- Price cache: in-memory, 15 minute TTL for spot & historical data.
- No persistence beyond the running process.

## Local Development

cd node-app
npm install
npm start

The UI runs at http://127.0.0.1:8000/. Helper scripts: run.sh (Unix) and run.bat (Windows).

## Extending

- Update symbol normalization or action heuristics in node-app/portfolio.js.
- Swap Yahoo data sources in node-app/priceProviders.js.
- Persist uploads or add auth by replacing the ephemeral storage layer.
- Add automated tests (currently none).

## Known Limitations

- Fidelity CSV variants with non-standard headers may need manual cleanup.
- Illiquid tickers can return null prices; affected rows show n/a metrics.
- Yahoo rate limits surface as missing_prices; retry later.

## Troubleshooting

- “Upload both an activity CSV and a positions CSV first”: ensure both uploads succeeded before recalculating.
- The /clear endpoint removes staged CSVs without computing; upload again afterwards.
- If port 8000 is occupied, set PORT before running npm start.
