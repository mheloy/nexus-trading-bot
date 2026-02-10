// Module 4 — Virtual Trading Engine
// Simulates real trade execution with SL/TP and position management

const PAIRS = {
  "EUR/USD": { price: 1.182, volatility: 0.0008, pip: 0.0001, digits: 4 },
  "GBP/USD": { price: 1.361, volatility: 0.001, pip: 0.0001, digits: 4 },
  "USD/JPY": { price: 157.2, volatility: 0.15, pip: 0.01, digits: 2 },
  "XAU/USD": { price: 4963.0, volatility: 6.0, pip: 0.01, digits: 2 },
  "USD/CAD": { price: 1.368, volatility: 0.0008, pip: 0.0001, digits: 4 },
  "AUD/USD": { price: 0.702, volatility: 0.0007, pip: 0.0001, digits: 4 },
};

function getDigits(pair) {
  const config = PAIRS[pair];
  if (!config) return 4;
  return config.digits !== undefined ? config.digits : (config.pip < 0.01 ? 4 : 2);
}

function getContractSize(pair) {
  // XAU/USD (Gold) uses 100 oz per lot
  // All Forex pairs use 100,000 units per lot
  if (pair === "XAU/USD") return 100;
  return 100000;
}

class TradeManager {
  constructor(startingBalance = 10000) {
    this.startingBalance = startingBalance;
    this.balance = startingBalance;
    this.openPositions = [];
    this.tradeLog = [];
    this.nextId = 1;
    this.lastPrices = new Map(); // pair -> latest known price
  }

  /**
   * Open a new position
   */
  openTrade(type, pair, price, config = {}) {
    const lotSize = config.lotSize || 0.1;
    const slPct = config.stopLoss || 0.002;
    const tpPct = config.takeProfit || 0.004;
    const digits = getDigits(pair);

    const sl =
      type === "BUY" ? price * (1 - slPct) : price * (1 + slPct);
    const tp =
      type === "BUY" ? price * (1 + tpPct) : price * (1 - tpPct);

    const position = {
      id: this.nextId++,
      type,
      pair,
      entry: price,
      lotSize,
      entryTime: Date.now(),
      entryTimestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      sl,
      tp,
      currentPrice: price,
      pnl: 0,
      pnlPct: 0,
      digits,
    };

    this.openPositions.push(position);
    return position;
  }

  /**
   * Update all open positions with current price and check SL/TP
   * @returns {Array} Closed trades from this tick
   */
  updatePositions(pair, currentPrice) {
    // Store latest price for this pair
    this.lastPrices.set(pair, currentPrice);

    const closedThisTick = [];

    this.openPositions = this.openPositions.filter((pos) => {
      // Determine the price to use for this position
      let priceForPos;
      if (pos.pair === pair) {
        priceForPos = currentPrice;
      } else {
        // Use last known price for other pairs, or keep current
        priceForPos = this.lastPrices.get(pos.pair) || pos.currentPrice;
      }

      pos.currentPrice = priceForPos;

      // Calculate P&L for ALL positions
      const contractSize = getContractSize(pos.pair);
      if (pos.type === "BUY") {
        pos.pnl =
          (priceForPos - pos.entry) * pos.lotSize * contractSize;
        pos.pnlPct =
          ((priceForPos - pos.entry) / pos.entry) * 100;
      } else {
        pos.pnl =
          (pos.entry - priceForPos) * pos.lotSize * contractSize;
        pos.pnlPct =
          ((pos.entry - priceForPos) / pos.entry) * 100;
      }

      // Only check SL/TP for positions matching the incoming tick's pair
      if (pos.pair !== pair) return true;

      // Check Stop Loss
      if (pos.type === "BUY" && currentPrice <= pos.sl) {
        closedThisTick.push(this._closePosition(pos, currentPrice, "Stop Loss"));
        return false;
      }
      if (pos.type === "SELL" && currentPrice >= pos.sl) {
        closedThisTick.push(this._closePosition(pos, currentPrice, "Stop Loss"));
        return false;
      }

      // Check Take Profit
      if (pos.type === "BUY" && currentPrice >= pos.tp) {
        closedThisTick.push(this._closePosition(pos, currentPrice, "Take Profit"));
        return false;
      }
      if (pos.type === "SELL" && currentPrice <= pos.tp) {
        closedThisTick.push(this._closePosition(pos, currentPrice, "Take Profit"));
        return false;
      }

      return true;
    });

    return closedThisTick;
  }

  /**
   * Manually close a position by ID
   */
  closePosition(positionId, currentPrice) {
    const idx = this.openPositions.findIndex((p) => p.id === positionId);
    if (idx === -1) return null;

    const pos = this.openPositions[idx];
    const closed = this._closePosition(pos, currentPrice, "Manual Close");
    this.openPositions.splice(idx, 1);
    return closed;
  }

  /**
   * Internal: close a position and record to trade log
   */
  _closePosition(pos, exitPrice, exitReason) {
    let pnl, pnlPct;
    const contractSize = getContractSize(pos.pair);
    if (pos.type === "BUY") {
      pnl = (exitPrice - pos.entry) * pos.lotSize * contractSize;
      pnlPct = ((exitPrice - pos.entry) / pos.entry) * 100;
    } else {
      pnl = (pos.entry - exitPrice) * pos.lotSize * contractSize;
      pnlPct = ((pos.entry - exitPrice) / pos.entry) * 100;
    }

    this.balance += pnl;

    const closedTrade = {
      ...pos,
      exit: exitPrice,
      exitTime: Date.now(),
      exitTimestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      pnl,
      pnlPct,
      result: pnl >= 0 ? "WIN" : "LOSS",
      exitReason,
      balanceAfter: this.balance,
    };

    this.tradeLog.push(closedTrade);
    return closedTrade;
  }

  /**
   * Get performance stats
   */
  getStats() {
    const wins = this.tradeLog.filter((t) => t.result === "WIN");
    const losses = this.tradeLog.filter((t) => t.result === "LOSS");
    const totalPnl = this.tradeLog.reduce((sum, t) => sum + t.pnl, 0);

    return {
      totalTrades: this.tradeLog.length,
      wins: wins.length,
      losses: losses.length,
      winRate:
        this.tradeLog.length > 0
          ? (wins.length / this.tradeLog.length) * 100
          : 0,
      totalPnl,
      netPnl: totalPnl,
      bestTrade:
        this.tradeLog.length > 0
          ? Math.max(...this.tradeLog.map((t) => t.pnl))
          : 0,
      worstTrade:
        this.tradeLog.length > 0
          ? Math.min(...this.tradeLog.map((t) => t.pnl))
          : 0,
      avgWin:
        wins.length > 0
          ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length
          : 0,
      avgLoss:
        losses.length > 0
          ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length
          : 0,
      profitFactor:
        losses.length > 0
          ? Math.abs(
              wins.reduce((s, t) => s + t.pnl, 0) /
                losses.reduce((s, t) => s + t.pnl, 0)
            )
          : wins.length > 0
            ? Infinity
            : 0,
      balance: this.balance,
      startBalance: this.startingBalance,
      openPositions: this.openPositions.length,
      signalsGenerated: 0,
    };
  }

  /**
   * Get formatted status report for Telegram
   */
  getStatusReport() {
    const stats = this.getStats();
    return [
      `<b>NEXUS STATUS</b>`,
      ``,
      `Balance: $${this.balance.toFixed(2)}`,
      `Open Positions: ${this.openPositions.length}`,
      `Total Trades: ${stats.totalTrades}`,
      `Win Rate: ${stats.winRate.toFixed(1)}%`,
      `Net P&L: ${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(2)}`,
    ].join("\n");
  }

  /**
   * Get open positions report for Telegram
   */
  getOpenPositionsReport() {
    if (this.openPositions.length === 0) {
      return "No open positions.";
    }
    const lines = this.openPositions.map((p) => {
      const pnlStr = p.pnl >= 0 ? `+$${p.pnl.toFixed(2)}` : `-$${Math.abs(p.pnl).toFixed(2)}`;
      return `${p.type} ${p.pair} @ ${p.entry.toFixed(p.digits)} | Lot: ${p.lotSize} | P&L: ${pnlStr} (${p.pnlPct.toFixed(2)}%)`;
    });
    return [`<b>OPEN POSITIONS</b>`, ``, ...lines].join("\n");
  }

  /**
   * Get performance report for Telegram
   */
  getPerformanceReport() {
    const stats = this.getStats();
    return [
      `<b>PERFORMANCE</b>`,
      ``,
      `Trades: ${stats.totalTrades}`,
      `Wins: ${stats.wins} | Losses: ${stats.losses}`,
      `Win Rate: ${stats.winRate.toFixed(1)}%`,
      `Profit Factor: ${stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}`,
      `Best: +$${stats.bestTrade.toFixed(2)}`,
      `Worst: $${stats.worstTrade.toFixed(2)}`,
      `Net P&L: ${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(2)}`,
      `Balance: $${stats.balance.toFixed(2)}`,
    ].join("\n");
  }

  /**
   * Get daily stats summary
   */
  getDailyStats() {
    const stats = this.getStats();
    return {
      ...stats,
      signalsGenerated: this._signalCount || 0,
    };
  }

  /**
   * Track signal count
   */
  incrementSignalCount() {
    this._signalCount = (this._signalCount || 0) + 1;
  }

  /**
   * Reset daily counters
   */
  resetDaily() {
    this._signalCount = 0;
  }
}

module.exports = { TradeManager, PAIRS, getDigits, getContractSize };
