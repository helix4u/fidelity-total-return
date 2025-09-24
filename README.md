# Fidelity Total Return (Node Edition)

This project computes dividend-aware total return from Fidelity CSV exports using a single Node.js backend and a static frontend.

## Features

- Upload Fidelity activity & positions CSVs directly from the browser.
- Cash-flow aware portfolio model with per-symbol ledgers (invested cash, dividends, TWR, IRR, ROC flags, exposure hints).
- Unitized daily NAV history powering TWR plus money-weighted IRR.
- Chart.js visualisations for portfolio NAV, cash flows, and per-symbol performance.
- Downloadable CSV snapshot including summary and per-symbol history.
- In-memory price caching via Yahoo Finance (15 minute TTL).

## Quick Start


up to date, audited 102 packages in 601ms

17 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

> fidelity-total-return-node@1.0.0 start
> node index.js

The server exposes the UI at .

### Scripts

-  /  wrap  for Windows and Unix-like environments.

## How It Works

1. Upload activity and positions CSVs exported from Fidelity.
2. The Node backend parses the files, builds per-symbol cash-flow ledgers, and resolves current & historical prices via Yahoo.
3. The performance engine computes:
   - **Div %** — dividends / invested cash.
   - **Mkt $ / Mkt %** — market value minus invested cash (absolute & percent).
   - **Total $ / Total %** — market value + dividends - invested cash (absolute & percent).
   - **NAV** — unitized net asset value for chaining returns.
   - **TWR** — time-weighted return (cash-flow independent).
   - **IRR** — money-weighted internal rate of return (cash-flow aware).
   - **ROC?** — badge indicating dividends likely dominated by return-of-capital behaviour.
4. Results are returned to the frontend for charting and export.

## File Layout



## Notes

- CSV uploads are stored under  and  during processing and removed after each calculation.
- Charts rely on daily Yahoo closes; missing quotes are forward-filled.
- The  endpoint wipes uploaded CSVs without recalculating.

## Support

If the tool is helpful, consider supporting it on [Ko-fi](https://ko-fi.com/gille).
