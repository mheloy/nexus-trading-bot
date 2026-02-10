// Module 9 — Candle Aggregator
// Converts raw price ticks into OHLCV candles

class CandleAggregator {
  constructor(intervalMs) {
    this.intervalMs = intervalMs; // e.g., 60000 for 1-minute candles
    this.currentCandle = null;
    this.candles = [];
  }

  /**
   * Add a price tick and aggregate into candles
   * @param {Object} tick - { price, timestamp, volume }
   * @returns {Object} Current (in-progress) candle
   */
  addTick(tick) {
    const candleStart =
      Math.floor(tick.timestamp / this.intervalMs) * this.intervalMs;

    if (!this.currentCandle || this.currentCandle.time !== candleStart) {
      // New candle — push previous if exists
      if (this.currentCandle) {
        this.candles.push({ ...this.currentCandle });
      }
      this.currentCandle = {
        time: candleStart,
        timestamp: new Date(candleStart).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume || 0,
      };
    } else {
      // Update existing candle
      this.currentCandle.high = Math.max(this.currentCandle.high, tick.price);
      this.currentCandle.low = Math.min(this.currentCandle.low, tick.price);
      this.currentCandle.close = tick.price;
      this.currentCandle.volume += tick.volume || 0;
    }

    return this.currentCandle;
  }

  /**
   * Get all completed candles + current in-progress candle
   * @param {number} count - Max number of candles to return
   * @returns {Array} Candle objects
   */
  getCandles(count = 200) {
    const all = [...this.candles];
    if (this.currentCandle) all.push(this.currentCandle);
    return all.slice(-count);
  }

  /**
   * Pre-load historical candles
   * @param {Array} historicalCandles - Array of candle objects
   */
  loadHistory(historicalCandles) {
    this.candles = [...historicalCandles];
    if (this.candles.length > 0) {
      this.currentCandle = this.candles.pop();
    }
  }

  /**
   * Get total candle count
   */
  get length() {
    return this.candles.length + (this.currentCandle ? 1 : 0);
  }
}

/**
 * Convert timeframe string to milliseconds
 */
function timeframeToMs(tf) {
  const map = {
    "1min": 60000,
    "5min": 300000,
    "15min": 900000,
    "30min": 1800000,
    "1h": 3600000,
    "4h": 14400000,
    "1day": 86400000,
  };
  return map[tf] || 60000;
}

module.exports = { CandleAggregator, timeframeToMs };
