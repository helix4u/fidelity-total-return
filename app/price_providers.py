from __future__ import annotations
from typing import Dict, Iterable, Optional, List
import time
import pandas as pd
import yfinance as yf

# 15-minute in-memory cache to avoid re-hitting Yahoo unnecessarily.
_TTL_SECONDS = 15 * 60
_CACHE: Dict[str, tuple[float, float]] = {}  # {symbol: (price, ts)}

# Add any weird symbol remaps here if Yahoo uses a different code
ALIASES: Dict[str, str] = {
    # "BRK.B": "BRK-B",
}

def _clean_symbol(s: str) -> Optional[str]:
    if not s:
        return None
    s = s.strip().upper()
    if not s or s == "CASH":
        return None
    if s.startswith("$"):
        s = s[1:]
    # many Yahoo tickers use '-' instead of '.'
    if "." in s and s not in ALIASES:
        s = s.replace(".", "-")
    return ALIASES.get(s, s)

def _from_cache(s: str) -> Optional[float]:
    got = _CACHE.get(s)
    if not got:
        return None
    price, ts = got
    if time.time() - ts <= _TTL_SECONDS:
        return price
    return None

def _put_cache(s: str, p: Optional[float]) -> None:
    if p is not None:
        _CACHE[s] = (float(p), time.time())

def _extract_last_close(df: pd.DataFrame, tickers: List[str]) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {t: None for t in tickers}
    if df is None or df.empty:
        return out
    # Normalize columns
    if isinstance(df.columns, pd.MultiIndex):
        # With group_by="ticker", top level = ticker, level 1 = OHLCV
        for t in tickers:
            try:
                s = df[(t, "Close")].dropna()
                if not s.empty:
                    out[t] = float(s.iloc[-1])
            except Exception:
                out[t] = None
    else:
        # Single-ticker case: columns are OHLCV
        s = df.get("Close")
        if s is not None:
            s = s.dropna()
            if not s.empty:
                out[tickers[0]] = float(s.iloc[-1])
    return out

def get_current_prices(symbols: Iterable[str]) -> Dict[str, Optional[float]]:
    # Clean + de-dupe
    cleaned: List[str] = []
    raw_to_clean: Dict[str, Optional[str]] = {}
    for raw in symbols:
        cs = _clean_symbol(raw)
        raw_to_clean[raw] = cs
        if cs and cs not in cleaned:
            cleaned.append(cs)

    # First serve from cache
    need: List[str] = []
    result: Dict[str, Optional[float]] = {}
    now = time.time()
    for s in cleaned:
        p = _from_cache(s)
        if p is not None:
            result[s] = p
        else:
            need.append(s)

    # Batch fetch any misses using yf.download (1 request for all tickers)
    # Use a few days and take the last valid close to sidestep partial/trading-halt days.
    if need:
        try:
            df = yf.download(
                need,
                period="5d",
                interval="1d",
                auto_adjust=False,
                group_by="ticker",
                threads=True,
                progress=False,
            )
            prices = _extract_last_close(df, need)
            for s, p in prices.items():
                if p is not None:
                    _put_cache(s, p)
                    result[s] = p
                else:
                    result[s] = None
        except Exception:
            # If Yahoo fully rate-limits, leave as None; UI will show n/a
            for s in need:
                result[s] = None

    # Map back to the original raws (so '$AGNC' etc. inherit the cleaned price)
    out: Dict[str, Optional[float]] = {}
    for raw, cs in raw_to_clean.items():
        out[raw] = result.get(cs, None) if cs else None
    return out
