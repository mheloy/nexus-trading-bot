// Module 9 — Twelve Data REST Client
// Fetches historical candles and indicators from Twelve Data API

const TWELVE_DATA_BASE = "https://api.twelvedata.com";

/**
 * Fetch with exponential backoff retry on rate limits
 */
async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const resp = await fetch(url);
    if (resp.status === 429) {
      const wait = Math.pow(2, attempt) * 1000;
      console.log(`Rate limited. Retrying in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return resp.json();
  }
  throw new Error("Max retries exceeded — Twelve Data rate limit");
}

/**
 * Fetch historical candles from Twelve Data REST API
 * @param {string} symbol - e.g. "EUR/USD"
 * @param {string} interval - e.g. "15min", "1h", "4h", "1day"
 * @param {number} outputsize - Number of candles (max 5000)
 * @returns {Array} Normalized candle objects
 */
async function fetchCandles(symbol, interval, outputsize = 200) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) throw new Error("TWELVEDATA_API_KEY not configured");

  const params = new URLSearchParams({
    symbol,
    interval,
    outputsize: String(outputsize),
    apikey: apiKey,
    timezone: "UTC",
    format: "JSON",
  });

  const url = `${TWELVE_DATA_BASE}/time_series?${params}`;
  const data = await fetchWithRetry(url);

  if (data.status === "error") {
    throw new Error(`Twelve Data Error: ${data.message}`);
  }

  if (!data.values || !Array.isArray(data.values)) {
    throw new Error("Twelve Data: unexpected response format");
  }

  // Twelve Data returns newest first — reverse to chronological order
  // Append " UTC" so Date parses as UTC, then toLocaleTimeString shows system time
  return data.values.reverse().map((candle) => ({
    time: new Date(candle.datetime + " UTC").getTime(),
    timestamp: new Date(candle.datetime + " UTC").toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    open: parseFloat(candle.open),
    high: parseFloat(candle.high),
    low: parseFloat(candle.low),
    close: parseFloat(candle.close),
    volume: parseInt(candle.volume) || 0,
  }));
}

/**
 * Fetch RSI from Twelve Data (for cross-validation)
 */
async function fetchRSI(symbol, interval, period = 14) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) throw new Error("TWELVEDATA_API_KEY not configured");

  const params = new URLSearchParams({
    symbol,
    interval,
    time_period: String(period),
    outputsize: "200",
    apikey: apiKey,
  });

  const url = `${TWELVE_DATA_BASE}/rsi?${params}`;
  const data = await fetchWithRetry(url);

  if (data.status === "error") {
    throw new Error(`Twelve Data RSI Error: ${data.message}`);
  }

  return data.values.reverse().map((v) => parseFloat(v.rsi));
}

/**
 * Fetch MACD from Twelve Data (for cross-validation)
 */
async function fetchMACD(symbol, interval) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) throw new Error("TWELVEDATA_API_KEY not configured");

  const params = new URLSearchParams({
    symbol,
    interval,
    fast_period: "12",
    slow_period: "26",
    signal_period: "9",
    outputsize: "200",
    apikey: apiKey,
  });

  const url = `${TWELVE_DATA_BASE}/macd?${params}`;
  const data = await fetchWithRetry(url);

  if (data.status === "error") {
    throw new Error(`Twelve Data MACD Error: ${data.message}`);
  }

  return data.values.reverse().map((v) => ({
    macd: parseFloat(v.macd),
    signal: parseFloat(v.macd_signal),
    histogram: parseFloat(v.macd_hist),
  }));
}

module.exports = { fetchCandles, fetchRSI, fetchMACD };
