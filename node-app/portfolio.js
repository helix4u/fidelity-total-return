const BUY_PAT = /YOU\s+BOUGHT/i;
const SELL_PAT = /YOU\s+SOLD/i;
const REINVEST_PAT = /REINVEST/i;
const DIV_PAT = /DIVIDEND\s+RECEIVED/i;

const CASH_TICKERS = new Set([
  "SPAXX",
  "FDRXX",
  "VMFXX",
  "SWVXX",
  "SPRXX",
  "SNVXX",
  "FCASH",
  "PENDING",
  "PENDING ACTIVITY",
  "CASH",
]);

const DATE_CANDIDATES = [
  "Run Date",
  "Date",
  "Activity Date",
  "Trade Date",
  "Settlement Date",
];

function isCashLike(symbolRaw, desc) {
  const s = (symbolRaw || "").trim().toUpperCase();
  const d = (desc || "").trim().toUpperCase();
  if (!s && !d) return true;
  if (s.startsWith("SPAXX")) return true;
  if (CASH_TICKERS.has(s)) return true;
  if (d.includes("MONEY MARKET") || d.includes("PENDING ACTIVITY")) return true;
  return false;
}

function normSymbol(value) {
  if (value === undefined || value === null) return null;
  let s = String(value).trim().toUpperCase();
  if (!s || CASH_TICKERS.has(s)) return null;
  if (s.startsWith("$")) s = s.slice(1);
  return s;
}

const SYMBOL_FROM_DESC = /^([A-Z][A-Z0-9\.]{0,9})/;
const SYMBOL_IN_PARENS = /\(([A-Z][A-Z0-9\.]{0,9})\)/;

function extractSymbol(symRaw, desc, action) {
  const norm = normSymbol(symRaw);
  if (norm) return norm;
  const d = (desc || "").trim().toUpperCase();
  const a = (action || "").toUpperCase();
  const paren = a.match(SYMBOL_IN_PARENS) || d.match(SYMBOL_IN_PARENS);
  if (paren) return normSymbol(paren[1]);
  const m = d.match(SYMBOL_FROM_DESC);
  if (m) return normSymbol(m[1]);
  return null;
}

function toNumber(val) {
  if (val === undefined || val === null) return 0;
  let s = String(val).trim();
  s = s.replace(/[\$,]/g, "").replace(/%/g, "");
  const m = s.match(/^\((.*)\)$/);
  if (m) s = `-${m[1]}`;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function dedupe(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function extractDate(row) {
  for (const key of DATE_CANDIDATES) {
    if (row[key]) {
      const dt = new Date(row[key]);
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }
  return null;
}

function classifyAction(action) {
  if (!action) return "other";
  if (DIV_PAT.test(action)) return "dividend";
  if (REINVEST_PAT.test(action)) return "reinvest";
  if (SELL_PAT.test(action)) return "sell";
  if (BUY_PAT.test(action)) return "buy";
  return "other";
}

function parseActivity(rows) {
  const ledgers = new Map();
  const entries = dedupe(rows);
  entries.forEach((row, index) => {
    const action = String(row.Action || "");
    const symRaw = row.Symbol ?? "";
    const desc = row.Description ?? "";
    const symbol = extractSymbol(symRaw, desc, action);
    if (!symbol || isCashLike(symRaw, desc)) return;

    const eventType = classifyAction(action);
    if (eventType === "other") return;

    const date = extractDate(row);
    if (!date) return;

    const qty = Math.abs(toNumber(row.Quantity));
    const amount = Math.abs(
      toNumber(row["Amount ($)"]) ||
      toNumber(row["Amount"]) ||
      toNumber(row["Net Amount"]) ||
      toNumber(row["Net Amount ($)"])
    );

    const ledger = ledgers.get(symbol) || {
      symbol,
      events: [],
      cashflows: [],
      dividendEvents: [],
      shareHistory: [],
      totalContributions: 0,
      totalWithdrawals: 0,
      netInvestedCash: 0,
      dividendsReceived: 0,
      currentShares: 0,
      startDate: null,
      endDate: null,
      closed: false,
      positionCostBasis: 0,
      effectiveCostBasis: 0,
      description: null,
    };

    const event = {
      date,
      action,
      eventType,
      sequence: index,
      sharesDelta: 0,
      cashFlow: 0,
      dividendAmount: 0,
      reinvested: false,
      description: desc,
      tradePrice: qty > 0 ? amount / qty : null,
    };

    switch (eventType) {
      case "buy":
        event.sharesDelta = qty;
        event.cashFlow = -amount;
        break;
      case "sell":
        event.sharesDelta = -qty;
        event.cashFlow = amount;
        break;
      case "dividend":
        event.dividendAmount = amount;
        event.cashFlow = amount;
        break;
      case "reinvest":
        event.dividendAmount = amount;
        event.sharesDelta = qty;
        event.cashFlow = 0;
        event.reinvested = true;
        break;
      default:
        break;
    }

    ledger.events.push(event);
    ledgers.set(symbol, ledger);
  });

  for (const ledger of ledgers.values()) {
    if (!ledger.events.length) continue;
    ledger.events.sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      const order = { dividend: 0, reinvest: 1, buy: 2, sell: 3, other: 4 };
      const oa = order[a.eventType] ?? 9;
      const ob = order[b.eventType] ?? 9;
      if (oa !== ob) return oa - ob;
      return a.sequence - b.sequence;
    });
    let shares = 0;
    const shareHistory = [];
    const dividendEvents = [];
    const cashflows = [];
    let startDate = null;
    let endDate = null;
    let totalContrib = 0;
    let totalWithdrawals = 0;
    let dividendsPaid = 0;
    ledger.events.forEach(event => {
      if (!startDate || event.date < startDate) startDate = event.date;
      if (!endDate || event.date > endDate) endDate = event.date;
      const before = shares;
      shares += event.sharesDelta;
      const after = shares;
      shareHistory.push({ date: event.date, shares: after });
      if (event.dividendAmount > 0) {
        dividendEvents.push({
          date: event.date,
          amount: event.dividendAmount,
          sharesAtEvent: before,
          reinvested: event.reinvested,
        });
        dividendsPaid += event.dividendAmount;
      }
      if (event.eventType === "buy") totalContrib += -event.cashFlow;
      if (event.eventType === "sell") totalWithdrawals += event.cashFlow;
      cashflows.push({
        date: event.date,
        amount: event.cashFlow,
        type: event.eventType,
        description: event.description,
        external: event.eventType !== "reinvest",
      });
    });
    ledger.shareHistory = shareHistory;
    ledger.dividendEvents = dividendEvents;
    ledger.cashflows = cashflows;
    ledger.totalContributions = totalContrib;
    ledger.totalWithdrawals = totalWithdrawals;
    ledger.netInvestedCash = totalContrib - totalWithdrawals;
    ledger.dividendsReceived = dividendsPaid;
    ledger.currentShares = shares;
    ledger.startDate = startDate;
    ledger.endDate = endDate;
    ledger.closed = shares <= 0;
  }
  return ledgers;
}

function parsePositions(rows) {
  const entries = dedupe(rows);
  const positions = new Map();
  entries.forEach(row => {
    const symRaw = row.Symbol ?? "";
    const desc = row.Description ?? "";
    const symbol = extractSymbol(symRaw, desc);
    if (!symbol || isCashLike(symRaw, desc)) return;
    const qty = toNumber(row.Quantity);
    if (qty <= 0) return;
    const cost = toNumber(row["Cost Basis Total"] ?? row["Cost Basis"]);
    const entry = positions.get(symbol) || { symbol, shares: 0, costBasis: 0, description: desc || null };
    entry.shares += qty;
    entry.costBasis += cost;
    if (!entry.description && desc) entry.description = desc;
    positions.set(symbol, entry);
  });
  return positions;
}

export function buildPortfolioModel(activityRows, positionRows) {
  const ledgers = parseActivity(activityRows);
  const positions = parsePositions(positionRows);
  const symbols = new Set([...ledgers.keys(), ...positions.keys()]);
  let startDate = null;
  let endDate = null;
  for (const symbol of symbols) {
    let ledger = ledgers.get(symbol);
    if (!ledger) {
      ledger = {
        symbol,
        events: [],
        cashflows: [],
        dividendEvents: [],
        shareHistory: [],
        totalContributions: 0,
        totalWithdrawals: 0,
        netInvestedCash: 0,
        dividendsReceived: 0,
        currentShares: 0,
        startDate: null,
        endDate: null,
        closed: true,
        positionCostBasis: 0,
        effectiveCostBasis: 0,
        description: null,
      };
      ledgers.set(symbol, ledger);
    }
    const pos = positions.get(symbol);
    if (pos) {
      ledger.positionCostBasis = pos.costBasis;
      ledger.currentShares = pos.shares;
      ledger.description = pos.description || ledger.description;
    }
    if (ledger.events && ledger.events.length) {
      if (!startDate || ledger.startDate < startDate) startDate = ledger.startDate;
      if (!endDate || ledger.endDate > endDate) endDate = ledger.endDate;
    }
    if (ledger.positionCostBasis > 0) {
      ledger.effectiveCostBasis = ledger.positionCostBasis;
    } else {
      ledger.effectiveCostBasis = ledger.netInvestedCash;
    }
    if (pos && pos.shares > 0) {
      ledger.closed = false;
    } else {
      ledger.closed = ledger.currentShares <= 0;
    }
  }

  return {
    symbols: Object.fromEntries([...ledgers.entries()]),
    startDate,
    endDate,
  };
}


