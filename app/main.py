from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import shutil
import pandas as pd
from .portfolio import compute_portfolio_summary
from .price_providers import get_current_prices

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"      # activity CSVs
POSITIONS_DIR = DATA_DIR / "positions"  # positions CSVs
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
POSITIONS_DIR.mkdir(parents=True, exist_ok=True)


def _clear_csvs(folder: Path) -> None:
    """Remove all CSV files in the given folder."""
    for p in folder.glob("*.csv"):
        try:
            p.unlink()
        except FileNotFoundError:
            pass

app = FastAPI(title="Total Return", version="1.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/app", StaticFiles(directory=str(ROOT / "frontend"), html=True), name="frontend")

@app.get("/", response_class=HTMLResponse)
def home():
    index = ROOT / "frontend" / "index.html"
    if not index.exists():
        return HTMLResponse("<pre>Frontend missing</pre>", status_code=500)
    return HTMLResponse(index.read_text(encoding="utf-8"))

@app.post("/upload")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file")
    dest = UPLOADS_DIR / file.filename
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    return {"ok": True, "filename": file.filename, "kind": "activity"}

@app.post("/upload_positions")
async def upload_positions_csv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file")
    dest = POSITIONS_DIR / file.filename
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    return {"ok": True, "filename": file.filename, "kind": "positions"}

def _read_many_csvs(folder: Path) -> pd.DataFrame | None:
    files = list(folder.glob("*.csv"))
    if not files:
        return None
    frames = []
    for p in files:
        try:
            frames.append(pd.read_csv(p))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse {p.name}: {e}")
    return pd.concat(frames, ignore_index=True) if frames else None

@app.get("/portfolio")
def portfolio():
    act_df = _read_many_csvs(UPLOADS_DIR)       # activity
    pos_df = _read_many_csvs(POSITIONS_DIR)     # positions
    if act_df is None or pos_df is None:
        raise HTTPException(status_code=400, detail="Upload both an activity CSV and a positions CSV first")

    summary = compute_portfolio_summary(act_df, pos_df)

    # prices
    symbols = [row["symbol"] for row in summary]
    prices = get_current_prices(symbols)

    # enrich + totals
    for row in summary:
        sym = row["symbol"]
        price = prices.get(sym)
        row["current_price"] = price
        row["market_value"] = float(price) * row["shares"] if price is not None else None

        invested = row["net_invested_cash"]
        divs = row["dividends_received"]
        mv = row["market_value"] if row["market_value"] is not None else 0.0

        if row["market_value"] is None and row["shares"] > 0:
            row["total_return_dollars"] = None
            row["total_return_percent"] = None
        else:
            tr = mv + divs - invested
            row["total_return_dollars"] = tr
            row["total_return_percent"] = (tr / invested) * 100.0 if invested > 0 else None

    total_invested = sum(r["net_invested_cash"] for r in summary)
    total_divs = sum(r["dividends_received"] for r in summary)
    total_mv = sum((r["market_value"] or 0.0) for r in summary)
    overall = {
        "invested": total_invested,
        "dividends": total_divs,
        "market_value": total_mv,
        "total_return_dollars": total_mv + total_divs - total_invested,
        "total_return_percent": ((total_mv + total_divs - total_invested) / total_invested * 100.0) if total_invested > 0 else None,
    }
    return {"rows": summary, "overall": overall, "missing_prices": [s for s, p in prices.items() if p is None]}
