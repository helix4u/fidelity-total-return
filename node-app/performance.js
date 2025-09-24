import { addDays, differenceInCalendarDays, eachDayOfInterval, isAfter, isBefore, isValid } from 'date-fns';
import { getCurrentPrices, getPriceHistory } from './priceProviders.js';

const EPSILON = 1e-9;

function normalizeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!isValid(d)) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dateRange(start, end) {
  const s = normalizeDate(start);
  const e = normalizeDate(end);
  if (!s || !e) return [];
  const dates = eachDayOfInterval({ start: s, end: e });
  return dates;
}

function buildSharesSeries(ledger, dates) {
  const map = new Map();
  for (const snap of ledger.shareHistory || []) {
    const day = normalizeDate(snap.date);
    if (!day) continue;
    if (isBefore(day, dates[0])) {
      map.set(dates[0].getTime(), snap.shares);
      continue;
    }
    if (isAfter(day, dates[dates.length - 1])) continue;
    map.set(day.getTime(), snap.shares);
  }
  const out = dates.map(() => 0);
  let last = 0;
  for (let i = 0; i < dates.length; i += 1) {
    const key = dates[i].getTime();
    if (map.has(key)) {
      last = map.get(key) ?? last;
    }
    out[i] = last;
  }
  if (!map.size && ledger.currentShares > 0) {
    out.fill(ledger.currentShares);
  }
  return out;
}

function buildCashflowSeries(ledger, dates) {
  const map = new Map();
  for (const cf of ledger.cashflows || []) {
    if (!cf.external || Math.abs(cf.amount) < EPSILON) continue;
    const day = normalizeDate(cf.date);
    if (!day) continue;
    if (isBefore(day, dates[0]) || isAfter(day, dates[dates.length - 1])) continue;
    const key = day.getTime();
    map.set(key, (map.get(key) || 0) + cf.amount);
  }
  return dates.map(d => map.get(d.getTime()) || 0);
}

function combineSeries(marketValues, cashflows) {
  const nav = [];
  const units = [];
  let unitPrice = 1;
  let unitCount = 0;
  for (let i = 0; i < marketValues.length; i += 1) {
    const mv = marketValues[i];
    const flow = cashflows[i];
    if (flow < -EPSILON) {
      if (Math.abs(unitPrice) < EPSILON) unitPrice = 1;
      unitCount += (-flow) / unitPrice;
    } else if (flow > EPSILON && unitPrice !== 0) {
      unitCount -= flow / unitPrice;
      if (unitCount < 0) unitCount = 0;
    }
    if (unitCount > 0 && mv != null) {
      unitPrice = mv / unitCount;
    }
    nav.push(unitPrice);
    units.push(unitCount);
  }
  return { nav, units };
}

function computeTwr(units, nav) {
  const valid = nav.filter((_, idx) => units[idx] > EPSILON && nav[idx] > EPSILON);
  if (!valid.length) return null;
  const first = nav.find((v, idx) => units[idx] > EPSILON && v > EPSILON);
  const last = [...nav].reverse().find((v, idx) => units[nav.length - 1 - idx] > EPSILON && v > EPSILON);
  if (!first || !last) return null;
  return last / first - 1;
}

function aggregateCashflows(flows) {
  const map = new Map();
  for (const [date, amount] of flows) {
    if (Math.abs(amount) < EPSILON) continue;
    const day = normalizeDate(date);
    if (!day) continue;
    const key = day.getTime();
    map.set(key, (map.get(key) || 0) + amount);
  }
  return [...map.entries()].map(([ts, amt]) => [new Date(Number(ts)), amt]).sort((a, b) => a[0] - b[0]);
}

function computeXirr(flows) {
  if (!flows.length) return null;
  const amounts = flows.map(([, amt]) => amt);
  const hasNeg = amounts.some(a => a < 0);
  const hasPos = amounts.some(a => a > 0);
  if (!hasNeg || !hasPos) return null;
  const start = flows[0][0];
  const xnpv = rate => flows.reduce((acc, [date, amt]) => {
    const days = differenceInCalendarDays(date, start);
    return acc + amt / ((1 + rate) ** (days / 365.25));
  }, 0);
  let low = -0.999;
  let high = 10;
  let fLow = xnpv(low);
  let fHigh = xnpv(high);
  let attempts = 0;
  while (fLow * fHigh > 0 && attempts < 10) {
    high *= 2;
    fHigh = xnpv(high);
    attempts += 1;
    if (high > 1e6) break;
  }
  if (fLow * fHigh > 0) return null;
  let mid = 0;
  for (let i = 0; i < 100; i += 1) {
    mid = (low + high) / 2;
    const fMid = xnpv(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return mid;
}

function buildHistoryFrame(symbol, dates, sharesSeries, priceSeries, cashflowSeries, navSeries, unitSeries) {
  const out = [];
  for (let i = 0; i < dates.length; i += 1) {
    out.push({
      date: dates[i].toISOString().slice(0, 10),
      shares: sharesSeries[i],
      price: priceSeries[i] == null ? null : Number(priceSeries[i]),
      market_value: priceSeries[i] == null ? null : priceSeries[i] * sharesSeries[i],
      cashflow: cashflowSeries[i] || 0,
      contribution: cashflowSeries[i] < -EPSILON ? Math.abs(cashflowSeries[i]) : 0,
      withdrawal: cashflowSeries[i] > EPSILON ? cashflowSeries[i] : 0,
      unit_nav: navSeries[i] || null,
      units: unitSeries[i] || 0,
    });
  }
  return out;
}

function extractExposureTags(symbol, description) {
  const tags = new Set();
  const desc = (description || '').toUpperCase();
  const sym = (symbol || '').toUpperCase();
  if ((desc.includes('S&P') && desc.includes('500')) || ['SPY', 'IVV', 'VOO'].includes(sym)) tags.add('s&p 500');
  if (desc.includes('TOTAL MARKET') || ['VTI', 'SCHB', 'ITOT'].includes(sym)) tags.add('total market');
  if (desc.includes('NASDAQ') || ['QQQ', 'ONEQ'].includes(sym)) tags.add('nasdaq');
  if (desc.includes('DIVIDEND') || desc.includes('YIELD')) tags.add('dividend focus');
  if (desc.includes('VALUE')) tags.add('value');
  if (desc.includes('GROWTH')) tags.add('growth');
  if (desc.includes('INTERNATIONAL') || desc.includes('INTL')) tags.add('international');
  if (desc.includes('EMERGING')) tags.add('emerging markets');
  if (desc.includes('SMALL CAP') || desc.includes('SMALL-CAP')) tags.add('small cap');
  if (desc.includes('MID CAP') || desc.includes('MID-CAP')) tags.add('mid cap');
  if (desc.includes('UTILIT')) tags.add('utilities');
  if (desc.includes('TECH') || desc.includes('INFORMATION TECHNOLOGY')) tags.add('technology');
  return [...tags];
}

export async function computePortfolioPerformance(model) {
  const symbols = Object.keys(model.symbols);
  if (!symbols.length) {
    return {
      rows: [],
      overall: {},
      history: { series: [] },
      symbol_histories: {},
      cashflows: {},
      dividends: {},
      missing_prices: [],
      overlap_groups: {},
    };
  }
  const start = model.startDate || addDays(new Date(), -365);
  const end = new Date();
  const currentPrices = await getCurrentPrices(symbols);
  const priceHistory = await getPriceHistory(symbols, start, end, '1d');
  const dateIndex = dateRange(start, end);

  const rows = [];
  const symbolHistories = {};
  const symbolCashflows = {};
  const symbolDividends = {};
  const overlapMap = new Map();
  const missingPrices = [];

  const overallMV = new Array(dateIndex.length).fill(0);
  const overallCF = new Array(dateIndex.length).fill(0);

  let lifetimeTotalReturn = 0;
  let lifetimeDividends = 0;

  for (const symbol of symbols) {
    const ledger = model.symbols[symbol];
    const currentPrice = currentPrices[symbol];
    if (currentPrice == null) missingPrices.push(symbol);
    const priceSeriesRaw = priceHistory[symbol] || [];
    const priceSeriesMap = new Map(priceSeriesRaw.map(entry => [normalizeDate(entry.date).getTime(), entry.close]));
    const sharesSeries = buildSharesSeries(ledger, dateIndex);
    const priceSeries = dateIndex.map(date => {
      const key = date.getTime();
      if (priceSeriesMap.has(key)) return priceSeriesMap.get(key);
      return null;
    });
    if (priceSeries[priceSeries.length - 1] == null && currentPrice != null) {
      priceSeries[priceSeries.length - 1] = currentPrice;
    }
    let lastSeen = null;
    for (let i = 0; i < priceSeries.length; i += 1) {
      if (priceSeries[i] == null && lastSeen != null) {
        priceSeries[i] = lastSeen;
      }
      if (priceSeries[i] != null) {
        lastSeen = priceSeries[i];
      }
    }
    lastSeen = null;
    for (let i = priceSeries.length - 1; i >= 0; i -= 1) {
      if (priceSeries[i] == null && lastSeen != null) {
        priceSeries[i] = lastSeen;
      }
      if (priceSeries[i] != null) lastSeen = priceSeries[i];
    }
    const cashflowSeries = buildCashflowSeries(ledger, dateIndex);
    const marketValueSeries = priceSeries.map((price, idx) => (price == null ? 0 : price * sharesSeries[idx]));
    const { nav, units } = combineSeries(marketValueSeries, cashflowSeries);
    const historyFrame = buildHistoryFrame(symbol, dateIndex, sharesSeries, priceSeries, cashflowSeries, nav, units);
    symbolHistories[symbol] = historyFrame;

    const totalInvested = ledger.effectiveCostBasis || 0;
    const dividends = ledger.dividendsReceived || 0;
    const marketValue = currentPrice != null ? currentPrice * ledger.currentShares : marketValueSeries[marketValueSeries.length - 1] || 0;
    const marketGain = marketValue - totalInvested;
    const totalReturn = marketValue + dividends - totalInvested;
    lifetimeTotalReturn += totalReturn;
    lifetimeDividends += dividends;

    const marketGainPercent = totalInvested > 0 ? (marketGain / totalInvested) * 100 : null;
    const dividendReturnPercent = totalInvested > 0 ? (dividends / totalInvested) * 100 : null;
    const totalReturnPercent = totalInvested > 0 ? (totalReturn / totalInvested) * 100 : null;

    const twr = computeTwr(units, nav);
    const flowsForIrr = ledger.cashflows
      .filter(cf => cf.external && Math.abs(cf.amount) > EPSILON)
      .map(cf => [normalizeDate(cf.date), cf.amount]);
    if (marketValue !== null && Math.abs(marketValue) > EPSILON) {
      flowsForIrr.push([normalizeDate(end), marketValue]);
    }
    const aggregatedFlows = aggregateCashflows(flowsForIrr);
    const irr = computeXirr(aggregatedFlows);

    const exposureTags = extractExposureTags(symbol, ledger.description);
    exposureTags.forEach(tag => {
      const arr = overlapMap.get(tag) || [];
      arr.push(symbol);
      overlapMap.set(tag, arr);
    });
    const rocFlag = dividends > 0 && totalInvested > 0 && marketGain < 0 && dividends >= totalInvested * 0.8;

    rows.push({
      symbol,
      description: ledger.description || null,
      shares: ledger.currentShares,
      closed: ledger.closed,
      net_invested_cash: totalInvested,
      dividends_received: dividends,
      current_price: currentPrice,
      market_value: marketValue,
      market_gain_dollars: marketGain,
      market_gain_percent: marketGainPercent,
      dividend_return_percent: dividendReturnPercent,
      total_return_dollars: totalReturn,
      total_return_percent: totalReturnPercent,
      twr_percent: twr == null ? null : twr * 100,
      irr_percent: irr == null ? null : irr * 100,
      roc_flag: rocFlag,
      exposure_tags: exposureTags,
    });

    symbolCashflows[symbol] = ledger.cashflows.map(cf => ({
      date: normalizeDate(cf.date)?.toISOString().slice(0, 10),
      amount: cf.amount,
      type: cf.type,
      description: cf.description || null,
    }));
    symbolDividends[symbol] = ledger.dividendEvents.map(div => ({
      date: normalizeDate(div.date)?.toISOString().slice(0, 10),
      amount: div.amount,
      shares_at_event: div.sharesAtEvent,
      reinvested: div.reinvested,
    }));

    for (let i = 0; i < overallMV.length; i += 1) {
      overallMV[i] += marketValueSeries[i] || 0;
      overallCF[i] += cashflowSeries[i] || 0;
    }
  }

  const overlapGroups = {};
  for (const [tag, list] of overlapMap.entries()) {
    if (list.length > 1) overlapGroups[tag] = list;
  }

  const { nav: overallNav, units: overallUnits } = combineSeries(overallMV, overallCF);
  const overallHistory = buildHistoryFrame('OVERALL', dateIndex, overallUnits.map(() => 0), overallMV.map(() => null), overallCF, overallNav, overallUnits);

  const activeRows = rows.filter(row => !row.closed);
  const invested = activeRows.reduce((acc, row) => acc + (row.net_invested_cash || 0), 0);
  const dividends = activeRows.reduce((acc, row) => acc + (row.dividends_received || 0), 0);
  const marketValue = activeRows.reduce((acc, row) => acc + (row.market_value || 0), 0);
  const marketGain = marketValue - invested;
  const totalReturn = marketValue + dividends - invested;
  const overallTwr = computeTwr(overallUnits, overallNav);
  const overallFlows = [];
  for (let i = 0; i < dateIndex.length; i += 1) {
    const cf = overallCF[i];
    if (Math.abs(cf) > EPSILON) overallFlows.push([dateIndex[i], cf]);
  }
  overallFlows.push([normalizeDate(end), marketValue]);
  const overallIrr = computeXirr(overallFlows);

  const overall = {
    invested,
    dividends,
    dividends_lifetime: lifetimeDividends,
    market_value: marketValue,
    market_gain_dollars: marketGain,
    market_gain_percent: invested > 0 ? (marketGain / invested) * 100 : null,
    dividend_return_percent: invested > 0 ? (dividends / invested) * 100 : null,
    total_return_dollars: totalReturn,
    total_return_percent: invested > 0 ? (totalReturn / invested) * 100 : null,
    total_return_dollars_lifetime: lifetimeTotalReturn,
    twr_percent: overallTwr == null ? null : overallTwr * 100,
    irr_percent: overallIrr == null ? null : overallIrr * 100,
  };

  return {
    rows,
    overall,
    history: { series: overallHistory },
    symbol_histories: symbolHistories,
    cashflows: symbolCashflows,
    dividends: symbolDividends,
    missing_prices: missingPrices,
    overlap_groups: overlapGroups,
  };
}
