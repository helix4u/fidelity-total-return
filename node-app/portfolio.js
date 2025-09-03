
// Match generic BUY/SELL verbs so that activity rows that omit the leading
// "YOU" still count. Fidelity's CSV exports can contain plain verbs like
// "BOUGHT" or "SOLD" which previously slipped through. We also treat any
// kind of reinvest instruction as a buy so dividend reinvestments are added
// to invested totals.
const BUY_PAT = /(BUY|BOUGHT)/i;
const SELL_PAT = /(SELL|SOLD)/i;
const REINVEST_PAT = /REINVEST/i;
const DIV_PAT = /DIVIDEND\s+RECEIVED/i;

const CASH_TICKERS = new Set([
  'SPAXX', 'FDRXX', 'VMFXX', 'SWVXX', 'SPRXX', 'SNVXX', 'FCASH',
  'PENDING', 'PENDING ACTIVITY', 'CASH'
]);

function stripQuotes(x) {
  return typeof x === 'string' ? x.replace(/^"+|"+$/g, '') : x;
}

function isCashLike(symbolRaw, desc) {
  const s = stripQuotes(symbolRaw || '').trim().toUpperCase();
  const d = stripQuotes(desc || '').trim().toUpperCase();
  if (!s && !d) return true;
  if (s.startsWith('SPAXX')) return true;
  if (CASH_TICKERS.has(s)) return true;
  if (d.includes('MONEY MARKET') || d.includes('PENDING ACTIVITY')) return true;
  return false;
}

function normSymbol(x) {
  if (x === undefined || x === null) return null;
  let s = stripQuotes(String(x)).trim().toUpperCase();
  if (!s || CASH_TICKERS.has(s)) return null;
  if (s.startsWith('$')) s = s.slice(1);
  return s;
}

const SYMBOL_FROM_DESC = /^([A-Z][A-Z0-9\.]{0,9})/;
const SYMBOL_IN_PARENS = /\(([A-Z][A-Z0-9\.]{0,9})\)/;

function extractSymbol(symRaw, desc, action) {
  const norm = normSymbol(symRaw);
  if (norm) return norm;
  const d = stripQuotes(desc || '').trim().toUpperCase();
  const a = stripQuotes(action || '').toUpperCase();
  const paren = a.match(SYMBOL_IN_PARENS) || d.match(SYMBOL_IN_PARENS);
  if (paren) return normSymbol(paren[1]);
  const m = d.match(SYMBOL_FROM_DESC);
  if (m) return normSymbol(m[1]);
  return null;
}

function toNumber(val) {
  if (val === undefined || val === null) return 0;
  let s = stripQuotes(String(val)).trim();
  s = s.replace(/[\$,]/g, '').replace(/%/g, '');
  const m = s.match(/^\((.*)\)$/);
  if (m) s = '-' + m[1];
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = JSON.stringify(r);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

function aggregateActivity(rows) {
  rows = dedupe(rows);
  const out = {};
  for (const row of rows) {
    const action = stripQuotes(String(row['Action'] || ''));
    const symRaw = stripQuotes(String(row['Symbol'] || ''));
    const desc = stripQuotes(String(row['Description'] || ''));
    const sym = extractSymbol(symRaw, desc, action);
    if (!sym || isCashLike(symRaw, desc)) continue;
    const qty = toNumber(row['Quantity']);
    const amount = toNumber(row['Amount ($)'] ?? row['Amount'] ?? row['Net Amount'] ?? row['Net Amount ($)']);
    const isBuy = BUY_PAT.test(action) || REINVEST_PAT.test(action);
    const isSell = SELL_PAT.test(action);
    const isDiv = DIV_PAT.test(action);
    if (!out[sym]) out[sym] = { shares_delta: 0, net_invested_cash: 0, dividends_received: 0 };
    if (isBuy) {
      out[sym].shares_delta += qty;
      out[sym].net_invested_cash += -Math.min(amount, 0);
    }
    if (isSell) {
      out[sym].shares_delta -= qty;
      out[sym].net_invested_cash -= Math.max(amount, 0);
    }
    if (isDiv) {
      out[sym].dividends_received += Math.max(amount, 0);
    }
  }
  return out;
}

function parsePositions(rows) {
  rows = dedupe(rows);
  const out = {};
  for (const row of rows) {
    const symRaw = stripQuotes(String(row['Symbol'] || ''));
    const desc = stripQuotes(String(row['Description'] || ''));
    const sym = extractSymbol(symRaw, desc);
    if (!sym || isCashLike(symRaw, desc)) continue;
    const qty = toNumber(row['Quantity']);
    if (qty <= 0) continue;
    const cost = toNumber(row['Cost Basis Total'] ?? row['Cost Basis']);
    if (!out[sym]) out[sym] = { base_shares: 0, cost_basis: 0 };
    out[sym].base_shares += qty;
    out[sym].cost_basis += cost;
  }
  return out;
}

function computePortfolioSummary(activityRows, positionsRows) {
  const act = aggregateActivity(activityRows);
  const pos = parsePositions(positionsRows);
  const symbols = Array.from(new Set([...Object.keys(act), ...Object.keys(pos)])).sort();
  const rows = [];
  for (const s of symbols) {
    let shares;
    let invested;
    if (pos[s]) {
      shares = pos[s].base_shares;
      invested = pos[s].cost_basis;
      if (invested <= 0 && act[s]) {
        invested = Math.max(invested, act[s].net_invested_cash);
      }
    } else {
      shares = act[s]?.shares_delta || 0;
      invested = act[s]?.net_invested_cash || 0;
    }
    const divs = act[s]?.dividends_received || 0;
    rows.push({
      symbol: s,
      shares: Number(shares),
      net_invested_cash: Number(invested),
      dividends_received: Number(divs)
    });
  }
  return rows;
}

export { aggregateActivity, parsePositions, computePortfolioSummary };
