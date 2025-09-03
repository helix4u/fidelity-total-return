# Fidelity Total Return

A small FastAPI application that calculates the total return of a stock portfolio, including dividends, using CSV exports from Fidelity.

Still has some parsing problems and doesn't account for data that has not been logged due to recency, etc. but is very close.

## Features

- Upload activity and positions CSV files.
- Aggregate transactions and positions into a portfolio summary.
- Fetch current prices with Yahoo Finance and compute market value and total return.
- Serve a minimal web interface for uploading files and viewing results.

## Quick start

- Grab exports of your positions and activity and orders history from Fidelity.
- Clone the repo and install and launch the server of your choice.
- Node.js version available because a friend uses SVP player... and they stick a portable python in the system path. This means he's allergic to python. It's super annoying.

## Node.js rewrite

A Node.js version of the server lives under `node-app`. Install dependencies and start it with:

```bash
cd node-app
npm install
npm start
```

...or...

## Python

Launch the python backend and web UI with:

```bash
./run.sh
```

On Windows use:

```
run.bat
```

The server listens on http://127.0.0.1:8000/.

## API

- `POST /upload` – upload one or more activity CSV files.
- `POST /upload_positions` – upload positions CSV files.
- `GET /portfolio` – return the combined portfolio summary with current prices and total return metrics.

Uploaded files are stored under `data/uploads` and `data/positions`.

## Support

If this project helps you, consider [supporting it on Ko-fi](https://ko-fi.com/gille).
