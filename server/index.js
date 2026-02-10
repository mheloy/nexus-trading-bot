// NEXUS Trading Bot — Backend Server Entry Point
// Wires all modules together: Express API, WebSocket, Twelve Data, Telegram

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { WebSocketServer, WebSocket } = require("ws");
const http = require("http");
const path = require("path");

const { enrichData } = require("./indicators");
const { generateSignals } = require("./signal-engine");
const { TradeManager, PAIRS } = require("./trade-manager");
const { fetchCandles } = require("./twelvedata");
const { TwelveDataStream } = require("./websocket-client");
const { CandleAggregator, timeframeToMs } = require("./candle-aggregator");
const { TelegramBot } = require("./telegram");
const { TelegramCommandHandler } = require("./telegram-commands");
const { Scheduler } = require("./scheduler");

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
};

// ── Initialize Components ──

const tradeManager = new TradeManager(10000);
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

// Current state
let currentPair = "EUR/USD";
let currentTimeframe = "15min";
let currentData = [];
let currentSrLevels = [];
let currentSignals = [];
let isLive = false;
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

    // Track signals
    result.signals.forEach((s) => {
      s.pair = pair;
      signalHistory.push(s);
      tradeManager.incrementSignalCount();
    });

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

  const position = tradeManager.openTrade(type, pair || currentPair, tradePrice);
  tradeManager.lastPrices.set(pair || currentPair, tradePrice);

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

  // Telegram notification
  const eventType = closed.result === "WIN" ? "closed_win" : "closed_loss";
  telegramBot.sendTradeUpdate(closed, eventType);

  res.json({ closed, balance: tradeManager.balance });
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
  res.json({
    dataSource,
    pair: currentPair,
    timeframe: currentTimeframe,
    isLive,
    balance: tradeManager.balance,
    openPositions: tradeManager.openPositions.length,
    telegramEnabled: config.telegram.enabled,
    twelveDataEnabled: config.twelveData.enabled,
    wsConnected: tdStream.isConnected(),
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
      s.sl =
        s.type === "BUY"
          ? s.price * (1 - 0.002)
          : s.price * (1 + 0.002);
      s.tp =
        s.type === "BUY"
          ? s.price * (1 + 0.004)
          : s.price * (1 - 0.004);

      signalHistory.push(s);
      tradeManager.incrementSignalCount();
      if (commandHandler.alertsEnabled) {
        telegramBot.sendSignalAlert(s);
      }
    });
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

// ── API: Live Mode Control ──

app.post("/api/live/start", async (req, res) => {
  const { pair, timeframe } = req.body;
  if (pair) currentPair = pair;
  if (timeframe) currentTimeframe = timeframe;

  isLive = true;

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

  res.json({
    status: "live",
    pair: currentPair,
    timeframe: currentTimeframe,
    dataSource,
  });
});

app.post("/api/live/stop", (req, res) => {
  isLive = false;
  stopSimulatedLive();
  tdStream.unsubscribe(currentPair);
  res.json({ status: "stopped" });
});

// API: Switch pair/timeframe during live mode
app.post("/api/live/switch", async (req, res) => {
  const { pair, timeframe } = req.body;
  if (!isLive) {
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

    // If live mode is active, properly switch the monitoring
    if (isLive) {
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
