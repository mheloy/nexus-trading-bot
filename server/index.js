// NEXUS Trading Bot — Backend Server Entry Point
// Wires all modules together: Express API, WebSocket, Twelve Data, Telegram

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { WebSocketServer, WebSocket } = require("ws");
const http = require("http");
const path = require("path");
const fs = require("fs");

const { enrichData } = require("./indicators");
const { generateSignals } = require("./signal-engine");
const { TradeManager, PAIRS, pipsToPrice } = require("./trade-manager");
const { fetchCandles } = require("./twelvedata");
const { TwelveDataStream } = require("./websocket-client");
const { CandleAggregator, timeframeToMs } = require("./candle-aggregator");
const { TelegramBot } = require("./telegram");
const { TelegramCommandHandler } = require("./telegram-commands");
const { Scheduler } = require("./scheduler");
const { isMarketOpen, getMarketStatus } = require("./market-hours");

// ── Configuration ──

const config = {
  twelveData: {
    apiKey: process.env.TWELVEDATA_API_KEY,
    enabled: !!process.env.TWELVEDATA_API_KEY,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },
  server: {
    port: parseInt(process.env.PORT || "3001"),
    dailySummaryHour: parseInt(process.env.DAILY_SUMMARY_HOUR || "23"),
  },
  marketHours: {
    enabled: process.env.ENABLE_MARKET_HOURS !== "false", // Default true
    autoStopOnClose: process.env.AUTO_STOP_ON_MARKET_CLOSE === "true", // Default false
    warnings: process.env.MARKET_HOURS_WARNING !== "false", // Default true
  },
};

// Load trading parameters from .env
const tradingParams = {
  startingBalance: parseFloat(process.env.STARTING_BALANCE || "10000"),
  lotSize: parseFloat(process.env.LOT_SIZE || "0.1"),
  stopLossPips: parseFloat(process.env.STOP_LOSS_PIPS || "150"),
  takeProfitPips: parseFloat(process.env.TAKE_PROFIT_PIPS || "300"),
  trailingStopDistance: parseFloat(process.env.TRAILING_STOP_DISTANCE || "150"),
  trailingStopActivation: parseFloat(process.env.TRAILING_STOP_ACTIVATION || "100"),
};

console.log("📊 Trading Parameters:", tradingParams);

// ── Initialize Components ──

const tradeManager = new TradeManager(tradingParams.startingBalance);

// ── Trade Persistence ──

const TRADES_FILE = path.join(__dirname, "..", "data", "trades.json");
let stateDirty = false;

// Load trading state from JSON
function loadTradingState() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRADES_FILE, "utf8"));
      tradeManager.balance = data.balance || 10000;
      tradeManager.startingBalance = data.startingBalance || 10000;
      tradeManager.openPositions = data.openPositions || [];
      tradeManager.tradeLog = data.tradeLog || [];
      tradeManager.nextId = Math.max(...data.openPositions.map(p => p.id), ...data.tradeLog.map(t => t.id), 0) + 1;

      // Load last used pair and timeframe
      if (data.lastPair) currentPair = data.lastPair;
      if (data.lastTimeframe) currentTimeframe = data.lastTimeframe;

      console.log(`💾 Loaded trading state: ${data.openPositions.length} open positions, balance $${data.balance.toFixed(2)}, pair: ${currentPair}`);
    }
  } catch (err) {
    console.error("❌ Failed to load trading state:", err.message);
  }
}

// Save trading state to JSON
function saveTradingState() {
  try {
    const state = {
      balance: tradeManager.balance,
      startingBalance: tradeManager.startingBalance,
      openPositions: tradeManager.openPositions,
      tradeLog: tradeManager.tradeLog,
      lastPair: currentPair,
      lastTimeframe: currentTimeframe,
      lastSaved: new Date().toISOString(),
    };

    // Ensure data directory exists
    const dataDir = path.join(__dirname, "..", "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(TRADES_FILE, JSON.stringify(state, null, 2));
    console.log(`💾 Saved trading state: ${state.openPositions.length} open, ${state.tradeLog.length} history`);
  } catch (err) {
    console.error("❌ Failed to save trading state:", err.message);
  }
}

// Load on startup
loadTradingState();

// Auto-save every 60 seconds if dirty
setInterval(() => {
  if (stateDirty) {
    saveTradingState();
    stateDirty = false;
  }
}, 60000);

const telegramBot = new TelegramBot(
  config.telegram.botToken,
  config.telegram.chatId
);
const signalHistory = [];
const commandHandler = new TelegramCommandHandler(
  telegramBot,
  tradeManager,
  signalHistory
);
const scheduler = new Scheduler(telegramBot, tradeManager);

// Twelve Data WebSocket stream
const tdStream = new TwelveDataStream(config.twelveData.apiKey);

// Candle aggregators per pair/timeframe
const aggregators = new Map();

// Current state (will be loaded from trades.json if available)
let currentPair = process.env.DEFAULT_PAIR || "XAU/USD";
let currentTimeframe = process.env.DEFAULT_TIMEFRAME || "5min";
let currentData = [];
let currentSrLevels = [];
let currentSignals = [];
let currentMode = process.env.DEFAULT_MODE || "STOP"; // "STOP" | "SIMULATION" | "LIVE"
let dataSource = config.twelveData.enabled ? "twelvedata" : "simulated";

// ── Simulated Data Generator ──

function generateSimulatedData(pair, count = 200) {
  const pairConfig = PAIRS[pair] || PAIRS["EUR/USD"];
  const basePrice = pairConfig.price;
  // Convert absolute volatility to percentage of price
  const volPct = pairConfig.volatility / basePrice;
  const data = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    const trend = Math.sin(i / 30) * volPct * 3;
    const noise = (Math.random() - 0.5) * volPct * 2;
    const momentum = Math.sin(i / 15) * volPct;

    // Percentage-based movement keeps prices proportional
    price *= (1 + trend + noise + momentum);

    const open = price;
    const range = price * volPct;
    const high = price + Math.random() * range;
    const low = price - Math.random() * range;
    const close = low + Math.random() * (high - low);

    const time = Date.now() - (count - i) * 60000;
    data.push({
      time,
      timestamp: new Date(time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      open,
      high,
      low,
      close,
      volume: Math.floor(Math.random() * 1000 + 500),
    });

    price = close;
  }

  return data;
}

// ── Data Fetching ──

async function getMarketData(pair, timeframe, count = 200) {
  try {
    if (!config.twelveData.enabled) {
      console.log("No API key — using simulated data");
      return { source: "simulated", data: generateSimulatedData(pair, count) };
    }

    const candles = await fetchCandles(pair, timeframe, count);
    return { source: "twelvedata", data: candles };
  } catch (error) {
    console.error(
      "Twelve Data error, falling back to simulation:",
      error.message
    );
    return { source: "simulated", data: generateSimulatedData(pair, count) };
  }
}

// ── Process Data Pipeline ──

function processData(rawData, pair) {
  const { data: enriched, srLevels } = enrichData(rawData);
  const signals = generateSignals(enriched, srLevels, pair);
  return { data: enriched, srLevels, signals };
}

// ── Express Server ──

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files in production
const distPath = path.join(__dirname, "..", "dist");
app.use(express.static(distPath));

// API: Get candle data with indicators
app.get("/api/candles", async (req, res) => {
  try {
    const pair = req.query.pair || currentPair;
    const tf = req.query.tf || currentTimeframe;
    const count = parseInt(req.query.count || "200");

    const { source, data: rawData } = await getMarketData(pair, tf, count);
    const result = processData(rawData, pair);

    currentData = result.data;
    currentSrLevels = result.srLevels;
    currentSignals = result.signals;
    currentPair = pair;
    currentTimeframe = tf;
    dataSource = source;

    // NOTE: Do NOT add historical signals to signalHistory or send alerts
    // Only live signals from handleLiveTick should be tracked
    // Historical signals are just for chart visualization

    res.json({
      source,
      pair,
      timeframe: tf,
      data: result.data,
      srLevels: result.srLevels,
      signals: result.signals,
    });
  } catch (err) {
    console.error("API /candles error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// API: Get current signals
app.get("/api/signals", (req, res) => {
  res.json({
    signals: currentSignals,
    history: signalHistory.slice(-20),
  });
});

// API: Get/manage positions
app.get("/api/positions", (req, res) => {
  res.json({
    open: tradeManager.openPositions,
    history: tradeManager.tradeLog,
    balance: tradeManager.balance,
    stats: tradeManager.getStats(),
  });
});

// API: Open a trade
app.post("/api/trade/open", (req, res) => {
  const { type, pair, price } = req.body;
  const tradePrice = price || currentData[currentData.length - 1]?.close;
  if (!tradePrice) {
    return res.status(400).json({ error: "No price data available" });
  }

  const config = {
    lotSize: tradingParams.lotSize,
    stopLossPips: tradingParams.stopLossPips,
    takeProfitPips: tradingParams.takeProfitPips,
    trailingStopDistance: tradingParams.trailingStopDistance,
    trailingStopActivation: tradingParams.trailingStopActivation,
  };

  const position = tradeManager.openTrade(type, pair || currentPair, tradePrice, config);
  tradeManager.lastPrices.set(pair || currentPair, tradePrice);
  stateDirty = true;

  // Telegram notification
  telegramBot.sendTradeUpdate(
    { ...position, pair: pair || currentPair },
    "opened"
  );

  res.json({ position, balance: tradeManager.balance });
});

// API: Close a trade
app.post("/api/trade/close", (req, res) => {
  const { positionId, price } = req.body;
  const closePrice = price || currentData[currentData.length - 1]?.close;

  const closed = tradeManager.closePosition(positionId, closePrice);
  if (!closed) {
    return res.status(404).json({ error: "Position not found" });
  }

  stateDirty = true;

  // Telegram notification
  const eventType = closed.result === "WIN" ? "closed_win" : "closed_loss";
  telegramBot.sendTradeUpdate(closed, eventType);

  res.json({ closed, balance: tradeManager.balance });
});

// ── API: Configuration Management ──

// GET /api/config - Get current trading parameters
app.get("/api/config", (req, res) => {
  res.json(tradingParams);
});

// POST /api/config - Update trading parameters (writes to .env)
app.post("/api/config", (req, res) => {
  const { startingBalance, lotSize, stopLossPips, takeProfitPips, trailingStopDistance, trailingStopActivation } = req.body;

  // Validate
  if (startingBalance && (startingBalance < 100 || startingBalance > 1000000)) {
    return res.status(400).json({ error: "Starting balance must be between 100 and 1,000,000" });
  }
  if (lotSize && (lotSize < 0.01 || lotSize > 1.0)) {
    return res.status(400).json({ error: "Lot size must be between 0.01 and 1.0" });
  }
  if (stopLossPips && (stopLossPips < 10 || stopLossPips > 3000)) {
    return res.status(400).json({ error: "Stop loss must be between 10 and 3000 pips" });
  }
  if (takeProfitPips && (takeProfitPips < 10 || takeProfitPips > 5000)) {
    return res.status(400).json({ error: "Take profit must be between 10 and 5000 pips" });
  }
  if (trailingStopDistance && (trailingStopDistance < 10 || trailingStopDistance > 3000)) {
    return res.status(400).json({ error: "Trailing stop distance must be between 10 and 3000 pips" });
  }
  if (trailingStopActivation && (trailingStopActivation < 10 || trailingStopActivation > 3000)) {
    return res.status(400).json({ error: "Trailing stop activation must be between 10 and 3000 pips" });
  }

  // Update in-memory config
  if (startingBalance !== undefined) tradingParams.startingBalance = startingBalance;
  if (lotSize !== undefined) tradingParams.lotSize = lotSize;
  if (stopLossPips !== undefined) tradingParams.stopLossPips = stopLossPips;
  if (takeProfitPips !== undefined) tradingParams.takeProfitPips = takeProfitPips;
  if (trailingStopDistance !== undefined) tradingParams.trailingStopDistance = trailingStopDistance;
  if (trailingStopActivation !== undefined) tradingParams.trailingStopActivation = trailingStopActivation;

  // Write to .env file
  try {
    const envPath = path.join(__dirname, "..", ".env");
    let envContent = fs.readFileSync(envPath, "utf8");

    // Update or append each value
    const updates = {
      STARTING_BALANCE: startingBalance,
      LOT_SIZE: lotSize,
      STOP_LOSS_PIPS: stopLossPips,
      TAKE_PROFIT_PIPS: takeProfitPips,
      TRAILING_STOP_DISTANCE: trailingStopDistance,
      TRAILING_STOP_ACTIVATION: trailingStopActivation,
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
          envContent += `\n${key}=${value}`;
        }
      }
    }

    fs.writeFileSync(envPath, envContent);
    console.log("📝 Updated .env with new trading parameters");
  } catch (err) {
    console.error("❌ Failed to write .env:", err.message);
    return res.status(500).json({ error: "Failed to persist configuration" });
  }

  res.json({ success: true, config: tradingParams });
});

// POST /api/reset - Reset all trades and balance
app.post("/api/reset", (req, res) => {
  try {
    // Close all open positions
    tradeManager.openPositions = [];

    // Clear trade log
    tradeManager.tradeLog = [];

    // Reset balance to starting balance
    tradeManager.balance = tradingParams.startingBalance;
    tradeManager.startingBalance = tradingParams.startingBalance;

    // Reset trade ID counter
    tradeManager.nextId = 1;

    // Save to file
    stateDirty = true;
    saveTradingState();

    console.log("🔄 Trading state reset to starting balance:", tradingParams.startingBalance);

    res.json({
      success: true,
      balance: tradeManager.balance,
      message: "All trades cleared and balance reset"
    });
  } catch (err) {
    console.error("❌ Failed to reset trading state:", err.message);
    return res.status(500).json({ error: "Failed to reset trading state" });
  }
});

// API: Run backtest
app.post("/api/backtest", async (req, res) => {
  try {
    const {
      pair = currentPair,
      timeframe = currentTimeframe,
      stopLoss = 0.002,
      takeProfit = 0.004,
      lotSize = 0.1,
      balance: startBalance = 10000,
    } = req.body;

    // Get 500 candles of data
    const { source, data: rawData } = await getMarketData(
      pair,
      timeframe,
      500
    );
    const { data: enriched, srLevels, signals } = processData(rawData, pair);

    // Walk through signals and simulate trades
    let btBalance = startBalance;
    const trades = [];
    const equityCurve = [{ trade: 0, balance: btBalance }];
    let openPos = null;

    for (let i = 0; i < enriched.length; i++) {
      const candle = enriched[i];

      // Check SL/TP on open position
      if (openPos) {
        let closed = false;
        let exitPrice, exitReason;

        if (openPos.type === "BUY") {
          if (candle.low <= openPos.sl) {
            exitPrice = openPos.sl;
            exitReason = "Stop Loss";
            closed = true;
          } else if (candle.high >= openPos.tp) {
            exitPrice = openPos.tp;
            exitReason = "Take Profit";
            closed = true;
          }
        } else {
          if (candle.high >= openPos.sl) {
            exitPrice = openPos.sl;
            exitReason = "Stop Loss";
            closed = true;
          } else if (candle.low <= openPos.tp) {
            exitPrice = openPos.tp;
            exitReason = "Take Profit";
            closed = true;
          }
        }

        if (closed) {
          let pnl;
          if (openPos.type === "BUY") {
            pnl = (exitPrice - openPos.entry) * lotSize * 100000;
          } else {
            pnl = (openPos.entry - exitPrice) * lotSize * 100000;
          }
          btBalance += pnl;

          trades.push({
            ...openPos,
            exit: exitPrice,
            pnl,
            pnlPct:
              openPos.type === "BUY"
                ? ((exitPrice - openPos.entry) / openPos.entry) * 100
                : ((openPos.entry - exitPrice) / openPos.entry) * 100,
            result: pnl >= 0 ? "WIN" : "LOSS",
            exitReason,
            balanceAfter: btBalance,
          });
          equityCurve.push({
            trade: trades.length,
            balance: btBalance,
          });
          openPos = null;
        }
      }

      // Check for new signal at this candle (if no position open)
      if (!openPos) {
        const signal = signals.find((s) => s.index === i);
        if (signal) {
          const sl =
            signal.type === "BUY"
              ? signal.price * (1 - stopLoss)
              : signal.price * (1 + stopLoss);
          const tp =
            signal.type === "BUY"
              ? signal.price * (1 + takeProfit)
              : signal.price * (1 - takeProfit);

          openPos = {
            type: signal.type,
            pair,
            entry: signal.price,
            entryTime: candle.time,
            entryTimestamp: candle.timestamp,
            sl,
            tp,
          };
        }
      }
    }

    // Calculate statistics
    const wins = trades.filter((t) => t.result === "WIN");
    const losses = trades.filter((t) => t.result === "LOSS");
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

    const result = {
      source,
      pair,
      timeframe,
      trades,
      wins: wins.length,
      losses: losses.length,
      totalPnl,
      winRate:
        trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
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
      maxDrawdown:
        trades.length > 0
          ? Math.min(...trades.map((t) => t.pnl))
          : 0,
      finalBalance: btBalance,
      startBalance,
      equityCurve,
    };

    res.json(result);
  } catch (err) {
    console.error("Backtest error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// API: System status
app.get("/api/status", (req, res) => {
  const marketStatus = getMarketStatus();
  res.json({
    dataSource,
    pair: currentPair,
    timeframe: currentTimeframe,
    mode: currentMode,
    balance: tradeManager.balance,
    openPositions: tradeManager.openPositions.length,
    telegramEnabled: config.telegram.enabled,
    twelveDataEnabled: config.twelveData.enabled,
    wsConnected: tdStream.isConnected(),
    marketHours: {
      enabled: config.marketHours.enabled,
      open: marketStatus.open,
      weekend: marketStatus.weekend,
      activeSessions: marketStatus.activeSessions,
      nextEvent: marketStatus.nextEvent,
      nextEventTime: marketStatus.nextEventTime,
    },
  });
});

// Serve frontend for all non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ── HTTP + WebSocket Server ──

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/api/live" });

// Track connected frontend clients
const frontendClients = new Set();

wss.on("connection", (ws) => {
  console.log("Frontend WebSocket client connected");
  frontendClients.add(ws);

  ws.on("close", () => {
    frontendClients.delete(ws);
  });

  // Send initial state
  ws.send(
    JSON.stringify({
      type: "init",
      data: {
        pair: currentPair,
        timeframe: currentTimeframe,
        dataSource,
        balance: tradeManager.balance,
      },
    })
  );
});

function broadcastToFrontend(message) {
  const payload = JSON.stringify(message);
  for (const client of frontendClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// ── Live Mode: Simulated Tick Engine ──

let simulationInterval = null;

function startSimulatedLive() {
  if (simulationInterval) return;

  let simPair = currentPair;
  let pairConfig = PAIRS[simPair] || PAIRS["EUR/USD"];
  let lastPrice = currentData.length > 0
    ? currentData[currentData.length - 1].close
    : pairConfig.price;

  simulationInterval = setInterval(() => {
    // If the active pair changed, reset the sim
    if (currentPair !== simPair) {
      simPair = currentPair;
      pairConfig = PAIRS[simPair] || PAIRS["EUR/USD"];
      lastPrice = currentData.length > 0
        ? currentData[currentData.length - 1].close
        : pairConfig.price;
    }

    // Percentage-based tick movement
    const volPct = pairConfig.volatility / pairConfig.price;
    const change = (Math.random() - 0.5) * volPct * 0.5;
    lastPrice *= (1 + change);

    const tick = {
      symbol: simPair,
      price: lastPrice,
      timestamp: Date.now(),
      volume: Math.floor(Math.random() * 100 + 50),
    };

    handleLiveTick(tick);
  }, 1500);
}

function stopSimulatedLive() {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
}

// ── Live Mode: Handle Incoming Ticks ──

function handleLiveTick(tick) {
  const key = `${tick.symbol}:${currentTimeframe}`;
  if (!aggregators.has(key)) {
    aggregators.set(
      key,
      new CandleAggregator(timeframeToMs(currentTimeframe))
    );
    // Pre-load existing data if available
    if (currentData.length > 0) {
      aggregators.get(key).loadHistory(
        currentData.map((c) => ({
          time: c.time,
          timestamp: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
      );
    }
  }

  const aggregator = aggregators.get(key);
  aggregator.addTick(tick);

  // Re-process all data with indicators
  const rawCandles = aggregator.getCandles(200);
  const { data: enriched, srLevels, signals } = processData(rawCandles, tick.symbol);

  currentData = enriched;
  currentSrLevels = srLevels;

  // Check for new signals
  const newSignals = signals.filter(
    (s) =>
      s.index === enriched.length - 1 ||
      s.index === enriched.length - 2
  );
  const brandNewSignals = newSignals.filter(
    (s) => !currentSignals.some((cs) => cs.time === s.time && cs.type === s.type)
  );

  if (brandNewSignals.length > 0) {
    brandNewSignals.forEach((s) => {
      s.pair = currentPair;
      const digits =
        PAIRS[currentPair]?.pip < 0.01 ? 4 : 2;
      s.digits = digits;

      // Use pip-based SL/TP calculation (matches actual trade execution)
      const slDistance = pipsToPrice(currentPair, tradingParams.stopLossPips);
      const tpDistance = pipsToPrice(currentPair, tradingParams.takeProfitPips);

      s.sl =
        s.type === "BUY"
          ? s.price - slDistance
          : s.price + slDistance;
      s.tp =
        s.type === "BUY"
          ? s.price + tpDistance
          : s.price - tpDistance;

      signalHistory.push(s);
      tradeManager.incrementSignalCount();
      if (commandHandler.alertsEnabled) {
        telegramBot.sendSignalAlert(s);
      }
    });

    // Auto-execute signals in SIMULATION mode
    if (currentMode === "SIMULATION") {
      // Check market hours before auto-executing
      if (config.marketHours.enabled && !isMarketOpen()) {
        const marketStatus = getMarketStatus();
        console.log(`⏸️  Auto-execution skipped: Markets closed (${marketStatus.weekend ? "Weekend" : "Between sessions"})`);

        // Send warning to Telegram if enabled
        if (config.marketHours.warnings && telegramBot.enabled && brandNewSignals.length > 0) {
          telegramBot.sendMessage(
            `⏸️ <b>Auto-Execution Blocked</b>\n\n` +
            `Signal generated but markets are closed.\n` +
            `${marketStatus.weekend ? "🔴 Weekend" : "🟡 Between sessions"}\n\n` +
            `Next Open: ${marketStatus.nextEventTime.toUTCString()}`
          );
        }
      } else {
        for (const signal of brandNewSignals) {
          // Check if position already exists for this pair (one position per pair)
          const existingPos = tradeManager.openPositions.find(p => p.pair === currentPair);

          if (existingPos) {
            console.log(`⚠️  Signal skipped: position already open for ${currentPair} (#${existingPos.id})`);
            continue;
          }

          // Auto-execute based on signal type
          const config = {
            lotSize: tradingParams.lotSize,
            stopLossPips: tradingParams.stopLossPips,
            takeProfitPips: tradingParams.takeProfitPips,
            trailingStopDistance: tradingParams.trailingStopDistance,
            trailingStopActivation: tradingParams.trailingStopActivation,
          };

          const position = tradeManager.openTrade(
            signal.type,
            currentPair,
            signal.price,
            config
          );

          console.log(`🤖 AUTO-EXECUTED ${signal.type} ${currentPair} @ ${signal.price.toFixed(position.digits)} (Signal confidence: ${signal.confidence.toFixed(0)}%)`);

          // Send Telegram notification
          if (telegramBot.enabled) {
            telegramBot.sendTradeUpdate(position, "opened");
          }

          // Mark state as dirty for persistence
          stateDirty = true;
        }
      }
    }
  }

  currentSignals = signals;

  // Update open positions and check SL/TP
  const closedTrades = tradeManager.updatePositions(
    tick.symbol,
    tick.price
  );
  closedTrades.forEach((trade) => {
    const eventType =
      trade.exitReason === "Stop Loss"
        ? "sl_hit"
        : trade.exitReason === "Take Profit"
          ? "tp_hit"
          : trade.result === "WIN"
            ? "closed_win"
            : "closed_loss";
    telegramBot.sendTradeUpdate(trade, eventType);
  });

  if (closedTrades.length > 0) {
    stateDirty = true;
  }

  // Update pair price for Telegram /market command
  commandHandler.updatePairPrice(
    tick.symbol,
    tick.price,
    currentData.length > 1
      ? currentData[currentData.length - 2].close
      : tick.price
  );

  // Broadcast to frontend
  broadcastToFrontend({
    type: "tick",
    data: {
      price: tick.price,
      timestamp: tick.timestamp,
      pair: tick.symbol,
      candle: enriched[enriched.length - 1],
      srLevels,
      signals: brandNewSignals,
      balance: tradeManager.balance,
      openPositions: tradeManager.openPositions,
      closedTrades,
    },
  });
}

// ── API: Mode Control ──

app.post("/api/mode/start", async (req, res) => {
  const { pair, timeframe, mode = "SIMULATION" } = req.body;

  // Validate mode
  if (!["SIMULATION", "LIVE"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode. Use SIMULATION or LIVE." });
  }

  if (mode === "LIVE") {
    return res.status(400).json({ error: "LIVE mode not yet implemented. Use SIMULATION." });
  }

  currentMode = mode;
  if (pair) currentPair = pair;
  if (timeframe) currentTimeframe = timeframe;

  // Load initial data first
  const { source, data: rawData } = await getMarketData(
    currentPair,
    currentTimeframe
  );
  const result = processData(rawData, currentPair);
  currentData = result.data;
  currentSrLevels = result.srLevels;
  currentSignals = result.signals;
  dataSource = source;

  // Start live tick stream
  if (config.twelveData.enabled && tdStream.isConnected()) {
    tdStream.subscribe(currentPair, handleLiveTick);
    dataSource = "twelvedata";
  } else {
    startSimulatedLive();
    dataSource = source === "twelvedata" ? "twelvedata" : "simulated";
  }

  console.log(`▶️  ${mode} mode started: ${currentPair} ${currentTimeframe}`);
  res.json({
    success: true,
    mode: currentMode,
    pair: currentPair,
    timeframe: currentTimeframe,
    dataSource,
  });
});

app.post("/api/mode/stop", (req, res) => {
  // Stop streams
  if (config.twelveData.enabled && tdStream.isConnected()) {
    tdStream.unsubscribe(currentPair);
  } else {
    stopSimulatedLive();
  }

  currentMode = "STOP";
  console.log("⏸️  Monitoring stopped");
  res.json({ success: true, mode: currentMode });
});

// API: Switch pair/timeframe during active mode
app.post("/api/mode/switch", async (req, res) => {
  const { pair, timeframe } = req.body;
  if (currentMode === "STOP") {
    return res.status(400).json({ error: "Live mode is not active" });
  }

  const oldPair = currentPair;

  // Stop current stream
  if (config.twelveData.enabled && tdStream.isConnected()) {
    tdStream.unsubscribe(oldPair);
  } else {
    stopSimulatedLive();
  }

  // Update state
  if (pair) {
    currentPair = pair;
    commandHandler.activePair = pair; // Sync Telegram command handler
  }
  if (timeframe) currentTimeframe = timeframe;

  // Reload data for new pair/timeframe
  const { source, data: rawData } = await getMarketData(currentPair, currentTimeframe);
  const result = processData(rawData, currentPair);
  currentData = result.data;
  currentSrLevels = result.srLevels;
  currentSignals = result.signals;
  dataSource = source;

  // Restart live stream for new pair
  if (config.twelveData.enabled && tdStream.isConnected()) {
    tdStream.subscribe(currentPair, handleLiveTick);
  } else {
    startSimulatedLive();
  }

  // Broadcast full data refresh to frontend
  broadcastToFrontend({
    type: "refresh",
    data: {
      pair: currentPair,
      timeframe: currentTimeframe,
      data: currentData,
      srLevels: currentSrLevels,
      signals: currentSignals,
      balance: tradeManager.balance,
      openPositions: tradeManager.openPositions,
      dataSource,
    },
  });

  res.json({
    status: "switched",
    pair: currentPair,
    timeframe: currentTimeframe,
    dataSource,
  });
});

// ── Start Server ──

server.listen(config.server.port, () => {
  console.log(`
╔══════════════════════════════════════════╗
║       NEXUS Trading Bot v2.0             ║
║       Server running on port ${config.server.port}         ║
╠══════════════════════════════════════════╣
║  Twelve Data: ${config.twelveData.enabled ? "ENABLED " : "DISABLED"} ${config.twelveData.enabled ? "✓" : "(simulated fallback)"}
║  Telegram:    ${config.telegram.enabled ? "ENABLED " : "DISABLED"} ${config.telegram.enabled ? "✓" : "(alerts off)         "}
║  API:         http://localhost:${config.server.port}/api  ║
║  WebSocket:   ws://localhost:${config.server.port}/api/live║
╚══════════════════════════════════════════╝
  `);

  // Register Telegram slash commands with BotFather API
  telegramBot.registerCommands();

  // Connect Twelve Data WebSocket if enabled
  if (config.twelveData.enabled) {
    tdStream.connect();
  }

  // Wire pair change from Telegram /pair command
  commandHandler.onPairChange = async (newPair) => {
    const oldPair = currentPair;

    // If monitoring is active, properly switch the pair
    if (currentMode !== "STOP") {
      // Stop current stream
      if (config.twelveData.enabled && tdStream.isConnected()) {
        tdStream.unsubscribe(oldPair);
      } else {
        stopSimulatedLive();
      }

      // Update state
      currentPair = newPair;

      // Reload data for new pair
      const { source, data: rawData } = await getMarketData(currentPair, currentTimeframe);
      const result = processData(rawData, currentPair);
      currentData = result.data;
      currentSrLevels = result.srLevels;
      currentSignals = result.signals;
      dataSource = source;

      // Restart live stream for new pair
      if (config.twelveData.enabled && tdStream.isConnected()) {
        tdStream.subscribe(currentPair, handleLiveTick);
      } else {
        startSimulatedLive();
      }

      // Broadcast full data refresh to frontend
      broadcastToFrontend({
        type: "refresh",
        data: {
          pair: currentPair,
          timeframe: currentTimeframe,
          data: currentData,
          srLevels: currentSrLevels,
          signals: currentSignals,
          balance: tradeManager.balance,
          openPositions: tradeManager.openPositions,
          dataSource,
        },
      });

      console.log(`Active pair switched via Telegram: ${oldPair} → ${newPair}`);
    } else {
      // Just update the variable if not live
      currentPair = newPair;
      console.log(`Active pair changed via Telegram: ${newPair} (not live, will apply on start)`);
    }
  };

  // Start Telegram command polling
  commandHandler.startPolling();

  // Start daily summary scheduler
  scheduler.start(config.server.dailySummaryHour);

  // Auto-start monitoring if DEFAULT_MODE is set to SIMULATION
  if (process.env.DEFAULT_MODE === "SIMULATION") {
    console.log("🔄 Auto-starting SIMULATION mode from DEFAULT_MODE env variable...");

    // Load initial data
    getMarketData(currentPair, currentTimeframe)
      .then(({ source, data: rawData }) => {
        const result = processData(rawData, currentPair);
        currentData = result.data;
        currentSrLevels = result.srLevels;
        currentSignals = result.signals;
        dataSource = source;

        // Start live tick stream
        if (config.twelveData.enabled && tdStream.isConnected()) {
          tdStream.subscribe(currentPair, handleLiveTick);
          console.log(`✅ SIMULATION mode started with LIVE data for ${currentPair}`);
        } else {
          startSimulatedLive();
          console.log(`✅ SIMULATION mode started with SIMULATED data for ${currentPair}`);
        }

        // Send startup notification to Telegram
        if (telegramBot.enabled) {
          telegramBot.sendMessage(
            `🚀 <b>NEXUS Auto-Started</b>\n\n` +
            `Mode: <b>SIMULATION</b>\n` +
            `Pair: ${currentPair}\n` +
            `Timeframe: ${currentTimeframe}\n` +
            `Data Source: ${dataSource === "twelvedata" ? "LIVE" : "SIMULATED"}\n` +
            `Markets: ${isMarketOpen() ? "🟢 OPEN" : "🔴 CLOSED"}\n\n` +
            `Auto-execution is <b>ACTIVE</b>`
          );
        }
      })
      .catch(err => {
        console.error("❌ Failed to auto-start SIMULATION mode:", err.message);
      });
  }
});

// ── Graceful Shutdown ──

process.on("SIGINT", () => {
  console.log("\nShutting down NEXUS...");
  stopSimulatedLive();
  tdStream.disconnect();
  commandHandler.stop();
  scheduler.stop();
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopSimulatedLive();
  tdStream.disconnect();
  commandHandler.stop();
  scheduler.stop();
  server.close();
  process.exit(0);
});
