from __future__ import annotations

import re
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

# ---------- helpers ----------
BUY_PAT = re.compile(r"YOU\s+BOUGHT", re.I)
SELL_PAT = re.compile(r"YOU\s+SOLD", re.I)
REINVEST_PAT = re.compile(r"REINVESTMENT", re.I)
DIV_PAT = re.compile(r"DIVIDEND\s+RECEIVED", re.I)

CASH_TICKERS = {
    "SPAXX", "FDRXX", "VMFXX", "SWVXX", "SPRXX", "SNVXX", "FCASH",
    "PENDING", "PENDING ACTIVITY", "CASH"
}

def _is_cash_like(symbol_raw: Optional[str], desc: Optional[str]) -> bool:
    s = (symbol_raw or "").strip().upper()
    d = (desc or "").strip().upper()
    if not s and not d:
        return True
    if s.startswith("SPAXX"):
        return True
    if s in CASH_TICKERS:
        return True
    if "MONEY MARKET" in d or "PENDING ACTIVITY" in d:
        return True
    return False

def _norm_symbol(x: object) -> Optional[str]:
    if pd.isna(x):
        return None
    s = str(x).strip().upper()
    if not s or s in CASH_TICKERS:
        return None
    if s.startswith("$"):
        s = s[1:]
    return s

def _get_col(df: pd.DataFrame, candidates: List[str]) -> Optional[pd.Series]:
    lower = {c.lower(): c for c in df.columns}
    for name in candidates:
        c = lower.get(name.lower())
        if c is not None:
            return df[c]
    return None

def _to_number(series: Optional[pd.Series], length: int) -> pd.Series:
    if series is None:
        return pd.Series([0.0] * length, dtype="float64")
    s = series.astype(str).replace({"": np.nan, "nan": np.nan, "None": np.nan, "--": np.nan})
    s = s.str.replace(r"[\$,,%]", "", regex=True).str.strip()
    s = s.str.replace(r"^\((.*)\)$", r"-\1", regex=True)  # (123.45) -> -123.45
    out = pd.to_numeric(s, errors="coerce")
    return out.fillna(0.0)

def _dedupe(df: Optional[pd.DataFrame]) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.drop_duplicates()
    keys = [c for c in ["Account Number","Account Name","Symbol","Description","Quantity","Cost Basis Total","Amount ($)","Run Date","Action"] if c in df.columns]
    if keys:
        df = df.drop_duplicates(subset=keys)
    return df

def _is_buy(action: str) -> bool:
    return bool(action and (BUY_PAT.search(action) or REINVEST_PAT.search(action)))

def _is_sell(action: str) -> bool:
    return bool(action and SELL_PAT.search(action))

def _is_div(action: str) -> bool:
    return bool(action and DIV_PAT.search(action))

# ---------- activity ----------
def aggregate_activity(df: Optional[pd.DataFrame]) -> Dict[str, Dict[str, float]]:
    df = _dedupe(df)
    if df.empty:
        return {}

    n = len(df)
    action_col = _get_col(df, ["Action"])
    action = action_col.astype(str) if action_col is not None else pd.Series([""] * n, dtype="object")

    sym_col = _get_col(df, ["Symbol"])
    desc_col = _get_col(df, ["Description"])
    sym_raw = sym_col.astype(str) if sym_col is not None else pd.Series([""] * n, dtype="object")
    desc = desc_col.astype(str) if desc_col is not None else pd.Series([""] * n, dtype="object")

    qty = _to_number(_get_col(df, ["Quantity"]), n)
    amount = _to_number(_get_col(df, ["Amount ($)", "Amount", "Net Amount", "Net Amount ($)"]), n)

    sym = sym_raw.apply(_norm_symbol)
    keep = sym.notna() & pd.Series([not _is_cash_like(sym_raw.iat[i], desc.iat[i]) for i in range(n)])

    a = pd.DataFrame({"action": action, "symbol": sym, "qty": qty, "amount": amount})[keep].copy()
    a["is_buy"] = a["action"].apply(_is_buy)
    a["is_sell"] = a["action"].apply(_is_sell)
    a["is_div"] = a["action"].apply(_is_div)

    out: Dict[str, Dict[str, float]] = {}
    for s, g in a.groupby("symbol", sort=True):
        buys = g[g.is_buy]
        sells = g[g.is_sell]
        divs = g[g.is_div]

        # shares from activity (used ONLY if positions missing)
        shares_delta = float(buys["qty"].sum() - sells["qty"].sum())

        # net invested (cash out on buys; cash in from sells)
        invested_out = float((-buys["amount"]).clip(lower=0).sum())
        proceeds_in = float((sells["amount"]).clip(lower=0).sum())
        net_invested_cash = invested_out - proceeds_in

        # dividends = ONLY the “DIVIDEND RECEIVED …” positives
        dividends_received = float(divs["amount"].clip(lower=0).sum())

        out[s] = dict(
            shares_delta=shares_delta,
            net_invested_cash=net_invested_cash,
            dividends_received=dividends_received,
        )
    return out

# ---------- positions ----------
def parse_positions(df: Optional[pd.DataFrame]) -> Dict[str, Dict[str, float]]:
    df = _dedupe(df)
    if df.empty:
        return {}

    n = len(df)
    sym_col = _get_col(df, ["Symbol"])
    desc_col = _get_col(df, ["Description"])
    qty_col = _get_col(df, ["Quantity"])
    cost_col = _get_col(df, ["Cost Basis Total", "Cost Basis"])

    sym_raw = sym_col.astype(str) if sym_col is not None else pd.Series([""] * n, dtype="object")
    desc = desc_col.astype(str) if desc_col is not None else pd.Series([""] * n, dtype="object")

    sym = sym_raw.apply(_norm_symbol)
    qty = _to_number(qty_col, n)
    cost = _to_number(cost_col, n)

    keep = sym.notna() & (qty > 0) & (~pd.Series([_is_cash_like(sym_raw.iat[i], desc.iat[i]) for i in range(n)]))
    dfp = pd.DataFrame({"symbol": sym, "qty": qty, "cost": cost})[keep]

    # group across accounts; sum shares & cost basis per symbol
    g = dfp.groupby("symbol", sort=True).agg(base_shares=("qty","sum"), cost_basis=("cost","sum")).reset_index()

    out: Dict[str, Dict[str, float]] = {}
    for _, row in g.iterrows():
        out[row["symbol"]] = dict(base_shares=float(row["base_shares"]), cost_basis=float(row["cost_basis"]))
    return out

# ---------- merge ----------
def compute_portfolio_summary(activity_df: Optional[pd.DataFrame],
                              positions_df: Optional[pd.DataFrame]) -> List[Dict[str, float]]:
    act = aggregate_activity(activity_df)
    pos = parse_positions(positions_df)

    symbols = sorted(set(act.keys()) | set(pos.keys()))
    rows: List[Dict[str, float]] = []

    for s in symbols:
        # Positions are authoritative for shares. Do NOT add activity shares on top.
        if s in pos:
            shares = pos[s]["base_shares"]
            invested = pos[s]["cost_basis"]
            # If positions file doesn’t carry a cost basis, fall back to activity net invested.
            if invested <= 0 and s in act:
                invested = max(invested, act[s].get("net_invested_cash", 0.0))
        else:
            # No positions row -> use activity-only view
            shares = act.get(s, {}).get("shares_delta", 0.0)
            invested = act.get(s, {}).get("net_invested_cash", 0.0)

        divs = act.get(s, {}).get("dividends_received", 0.0)

        rows.append({
            "symbol": s,
            "shares": float(shares),
            "net_invested_cash": float(invested),
            "dividends_received": float(divs),
        })

    rows.sort(key=lambda r: r["symbol"])
    return rows
