// Module 3 — Signal Generator (Confluence System)
// Combines S/R, RSI, and MACD into weighted score

const { getDigits } = require("./trade-manager");

/**
 * Generate trade signals using confluence scoring
 * @param {Array} data - Enriched candle data (with indicators)
 * @param {Array} srLevels - Support/Resistance levels
 * @param {string} pair - Currency pair (for formatting)
 * @returns {Array} Array of signal objects
 */
function generateSignals(data, srLevels, pair) {
  const digits = getDigits(pair);
  const signals = [];
  let lastSignalIndex = -Infinity;
  let lastSignalType = null;
  const COOLDOWN_CANDLES = 5; // Min candles between same-type signals

  // Start at index 30 to ensure all indicators are populated
  for (let i = 30; i < data.length; i++) {
    const candle = data[i];
    const prevCandle = data[i - 1];

    if (
      candle.rsi === null ||
      candle.macd === null ||
      candle.macdSignal === null
    ) {
      continue;
    }

    // Step 1: S/R Score
    let srScore = 0;
    const nearLevels = [];
    for (const level of srLevels) {
      const distance = Math.abs(candle.close - level.price) / candle.close;
      if (distance < 0.003) {
        if (level.type === "support" && candle.close >= level.price) {
          srScore += level.strength;
          nearLevels.push(
            `Near support ${level.price.toFixed(digits)} (strength: ${level.strength})`
          );
        }
        if (level.type === "resistance" && candle.close <= level.price) {
          srScore -= level.strength;
          nearLevels.push(
            `Near resistance ${level.price.toFixed(digits)} (strength: ${level.strength})`
          );
        }
      }
    }

    // Step 2: RSI Score
    let rsiScore = 0;
    const rsiReasons = [];
    if (candle.rsi < 30) {
      rsiScore = 2;
      rsiReasons.push(`RSI oversold (${candle.rsi.toFixed(1)})`);
    } else if (candle.rsi < 40) {
      rsiScore = 1;
      rsiReasons.push(`RSI mildly oversold (${candle.rsi.toFixed(1)})`);
    } else if (candle.rsi > 70) {
      rsiScore = -2;
      rsiReasons.push(`RSI overbought (${candle.rsi.toFixed(1)})`);
    } else if (candle.rsi > 60) {
      rsiScore = -1;
      rsiReasons.push(`RSI mildly overbought (${candle.rsi.toFixed(1)})`);
    }

    // Step 3: MACD Score
    let macdScore = 0;
    const macdReasons = [];

    // Crossover detection
    if (
      prevCandle.macd !== null &&
      prevCandle.macdSignal !== null
    ) {
      const prevDiff = prevCandle.macd - prevCandle.macdSignal;
      const currDiff = candle.macd - candle.macdSignal;

      if (prevDiff <= 0 && currDiff > 0) {
        macdScore = 2;
        macdReasons.push("MACD bullish crossover");
      } else if (prevDiff >= 0 && currDiff < 0) {
        macdScore = -2;
        macdReasons.push("MACD bearish crossover");
      }
    }

    // Histogram momentum
    if (
      candle.histogram !== null &&
      prevCandle.histogram !== null
    ) {
      if (Math.abs(candle.histogram) > Math.abs(prevCandle.histogram)) {
        if (candle.histogram > 0) {
          macdScore += 0.5;
          macdReasons.push("MACD histogram growing (bullish)");
        } else {
          macdScore -= 0.5;
          macdReasons.push("MACD histogram growing (bearish)");
        }
      }
    }

    // Step 4: Combine & Threshold
    const totalScore = srScore + rsiScore + macdScore;
    const confidence = Math.min(100, Math.abs(totalScore) * 20);
    const reasons = [...nearLevels, ...rsiReasons, ...macdReasons];

    let signalType = null;
    if (totalScore >= 3 && confidence >= 40) signalType = "BUY";
    else if (totalScore <= -3 && confidence >= 40) signalType = "SELL";

    // Cooldown: skip if same signal type fired within last N candles
    if (signalType) {
      const isCooldown =
        signalType === lastSignalType &&
        i - lastSignalIndex < COOLDOWN_CANDLES;

      if (!isCooldown) {
        signals.push({
          index: i,
          time: candle.time,
          timestamp: candle.timestamp,
          type: signalType,
          price: candle.close,
          confidence,
          reasons,
          rsi: candle.rsi,
          macd: candle.macd,
          macdSignal: candle.macdSignal,
          score: totalScore,
        });
        lastSignalIndex = i;
        lastSignalType = signalType;
      }
    }
  }

  return signals;
}

module.exports = { generateSignals };
