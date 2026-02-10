// Module 2 — Technical Analysis Core
// Pure functions: data in, numbers out

/**
 * Simple Moving Average
 * @param {Array} data - Array of candle objects with .close
 * @param {number} period - Lookback period
 * @returns {Array} SMA values (null for insufficient data)
 */
function calcSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    result.push(sum / period);
  }
  return result;
}

/**
 * Exponential Moving Average
 * Seeded with SMA of the first `period` candles
 * @param {Array} data - Array of candle objects with .close
 * @param {number} period - Lookback period
 * @returns {Array} EMA values (null for insufficient data)
 */
function calcEMA(data, period) {
  const result = [];
  const k = 2 / (period + 1);

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    if (i === period - 1) {
      // Seed with SMA
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[j].close;
      }
      result.push(sum / period);
      continue;
    }
    const prev = result[i - 1];
    if (prev === null) {
      result.push(null);
      continue;
    }
    result.push(data[i].close * k + prev * (1 - k));
  }
  return result;
}

/**
 * Relative Strength Index
 * @param {Array} data - Array of candle objects with .close
 * @param {number} period - RSI period (default 14)
 * @returns {Array} RSI values 0-100 (null for insufficient data)
 */
function calcRSI(data, period = 14) {
  const result = [];

  if (data.length < period + 1) {
    return data.map(() => null);
  }

  // Calculate price changes
  const changes = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      changes.push(0);
    } else {
      changes.push(data[i].close - data[i - 1].close);
    }
  }

  // First average gain/loss using SMA
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Fill nulls for insufficient data
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  // First RSI value
  if (avgLoss === 0) {
    result.push(100);
  } else {
    const rs = avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  // Subsequent values using smoothed averages
  for (let i = period + 1; i < data.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }

  return result;
}

/**
 * MACD (12, 26, 9)
 * @param {Array} data - Array of candle objects with .close
 * @returns {Object} { macd: [], signal: [], histogram: [] }
 */
function calcMACD(data) {
  const ema12 = calcEMA(data, 12);
  const ema26 = calcEMA(data, 26);

  // MACD line = EMA(12) - EMA(26)
  const macdLine = [];
  for (let i = 0; i < data.length; i++) {
    if (ema12[i] === null || ema26[i] === null) {
      macdLine.push(null);
    } else {
      macdLine.push(ema12[i] - ema26[i]);
    }
  }

  // Signal line = EMA(9) of MACD line
  // We need to compute EMA on macdLine values, not candle objects
  const signalLine = [];
  const signalPeriod = 9;
  const k = 2 / (signalPeriod + 1);

  // Find the first non-null MACD values for seeding
  const nonNullStart = macdLine.findIndex((v) => v !== null);

  for (let i = 0; i < data.length; i++) {
    if (i < nonNullStart + signalPeriod - 1 || macdLine[i] === null) {
      signalLine.push(null);
      continue;
    }
    if (i === nonNullStart + signalPeriod - 1) {
      // Seed signal with SMA of first 9 MACD values
      let sum = 0;
      for (let j = nonNullStart; j < nonNullStart + signalPeriod; j++) {
        sum += macdLine[j];
      }
      signalLine.push(sum / signalPeriod);
      continue;
    }
    const prev = signalLine[i - 1];
    if (prev === null) {
      signalLine.push(null);
      continue;
    }
    signalLine.push(macdLine[i] * k + prev * (1 - k));
  }

  // Histogram = MACD - Signal
  const histogram = [];
  for (let i = 0; i < data.length; i++) {
    if (macdLine[i] === null || signalLine[i] === null) {
      histogram.push(null);
    } else {
      histogram.push(macdLine[i] - signalLine[i]);
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Support & Resistance Detection
 * @param {Array} data - Array of candle objects
 * @param {number} lookback - Pivot detection window (default 20)
 * @returns {Array} S/R level objects sorted by strength
 */
function calcSupportResistance(data, lookback = 20) {
  const pivots = [];

  for (let i = lookback; i < data.length - lookback; i++) {
    let isHighPivot = true;
    let isLowPivot = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (data[j].high >= data[i].high) isHighPivot = false;
      if (data[j].low <= data[i].low) isLowPivot = false;
    }

    if (isHighPivot) {
      pivots.push({ price: data[i].high, type: "resistance", index: i });
    }
    if (isLowPivot) {
      pivots.push({ price: data[i].low, type: "support", index: i });
    }
  }

  // Cluster nearby levels (within 0.2% of each other)
  const clusters = [];
  const used = new Set();

  for (let i = 0; i < pivots.length; i++) {
    if (used.has(i)) continue;
    const cluster = [pivots[i]];
    used.add(i);

    for (let j = i + 1; j < pivots.length; j++) {
      if (used.has(j)) continue;
      const diff = Math.abs(pivots[i].price - pivots[j].price) / pivots[i].price;
      if (diff < 0.002) {
        cluster.push(pivots[j]);
        used.add(j);
      }
    }

    // Average the cluster
    const avgPrice =
      cluster.reduce((sum, p) => sum + p.price, 0) / cluster.length;
    const type =
      cluster.filter((p) => p.type === "support").length >=
      cluster.filter((p) => p.type === "resistance").length
        ? "support"
        : "resistance";

    clusters.push({
      type,
      price: avgPrice,
      strength: cluster.length,
      touches: cluster.length,
    });
  }

  // Sort by strength descending, keep top 6
  clusters.sort((a, b) => b.strength - a.strength);
  return clusters.slice(0, 6);
}

/**
 * Enrich data array with all indicator values
 * @param {Array} data - Array of candle objects
 * @returns {Object} { data: enriched[], srLevels: [] }
 */
function enrichData(data) {
  const sma20 = calcSMA(data, 20);
  const sma50 = calcSMA(data, 50);
  const rsi = calcRSI(data, 14);
  const { macd, signal, histogram } = calcMACD(data);
  const srLevels = calcSupportResistance(data);

  const enriched = data.map((candle, i) => ({
    ...candle,
    sma20: sma20[i],
    sma50: sma50[i],
    rsi: rsi[i],
    macd: macd[i],
    macdSignal: signal[i],
    histogram: histogram[i],
  }));

  return { data: enriched, srLevels };
}

module.exports = {
  calcSMA,
  calcEMA,
  calcRSI,
  calcMACD,
  calcSupportResistance,
  enrichData,
};
