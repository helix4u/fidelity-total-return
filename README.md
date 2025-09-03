# Fidelity Total Return

A small FastAPI application that calculates the total return of a stock portfolio, including dividends, using CSV exports from Fidelity.

## Features

- Upload activity and positions CSV files.
- Aggregate transactions and positions into a portfolio summary.
- Fetch current prices with Yahoo Finance and compute market value and total return.
- Serve a minimal web interface at `/app` for uploading files and viewing results.

## Quick start

Launch the Node.js backend and web UI with:

```bash
./run.sh
```

On Windows use:

```
run.bat
```

The server listens on http://127.0.0.1:8000/.

### Python version

The original FastAPI backend is still available if needed:

```bash
python bootstrap.py
```

## API

- `POST /upload` – upload one or more activity CSV files.
- `POST /upload_positions` – upload positions CSV files.
- `GET /portfolio` – return the combined portfolio summary with current prices and total return metrics.

Uploaded files are stored under `data/uploads` and `data/positions`.

## Development

Dependencies are listed in `requirements.txt`. After modifying the code, run the test suite (none are present yet, but this will initialize pytest):

```bash
pytest
```


## Node.js rewrite

A Node.js version of the server lives under `node-app`. Install dependencies and start it with:

```bash
cd node-app
npm install
npm start
```
