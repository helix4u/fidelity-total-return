import yahooFinance from 'yahoo-finance2';

const TTL_MS = 15 * 60 * 1000;
const CACHE = new Map();

function cleanSymbol(s) {
  if (!s) return null;
  s = s.trim().toUpperCase();
  if (!s || s === 'CASH') return null;
  if (s.startsWith('$')) s = s.slice(1);
  if (s.includes('.')) s = s.replace('.', '-');
  return s;
}

export async function getCurrentPrices(symbols) {
  const cleaned = [];
  const rawToClean = {};
  for (const raw of symbols) {
    const cs = cleanSymbol(raw);
    rawToClean[raw] = cs;
    if (cs && !cleaned.includes(cs)) cleaned.push(cs);
  }
  const result = {};
  const need = [];
  const now = Date.now();
  for (const s of cleaned) {
    const entry = CACHE.get(s);
    if (entry && now - entry.ts <= TTL_MS) {
      result[s] = entry.price;
    } else {
      need.push(s);
    }
  }
  if (need.length) {
    try {
      const quotes = await yahooFinance.quote(need);
      const arr = Array.isArray(quotes) ? quotes : [quotes];
      for (const q of arr) {
        if (q && q.regularMarketPrice != null) {
          result[q.symbol] = q.regularMarketPrice;
          CACHE.set(q.symbol, { price: q.regularMarketPrice, ts: now });
        } else {
          result[q.symbol] = null;
        }
      }
    } catch (err) {
      for (const s of need) result[s] = null;
    }
  }
  const out = {};
  for (const raw in rawToClean) {
    const cs = rawToClean[raw];
    out[raw] = cs ? result[cs] ?? null : null;
  }
  return out;
}
