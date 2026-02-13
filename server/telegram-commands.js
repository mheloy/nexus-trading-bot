// Module 10 — Telegram Command Handler
// Processes incoming commands from Telegram (/status, /signals, etc.)

const { isMarketOpen, getMarketStatus, getMarketStatusReport } = require("./market-hours");

const SUPPORTED_PAIRS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "USD/CAD", "AUD/USD",
];

class TelegramCommandHandler {
  constructor(bot, tradeManager, signalHistory) {
    this.bot = bot;
    this.tradeManager = tradeManager;
    this.signalHistory = signalHistory || [];
    this.pollingInterval = null;
    this.lastUpdateId = 0;
    this.pairPrices = new Map();
    this.alertsEnabled = true;
    this.activePair = "EUR/USD";
    this.onPairChange = null; // callback set by server
  }

  startPolling(intervalMs = 2000) {
    if (!this.bot.enabled) {
      console.log("Telegram not configured — command polling disabled");
      return;
    }
    console.log("Telegram command polling started");
    this.pollingInterval = setInterval(() => this.checkUpdates(), intervalMs);
  }

  async checkUpdates() {
    try {
      const url = `${this.bot.baseUrl}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=1`;
      const resp = await this.bot._fetch(url);
      const data = await resp.json();

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;

          // Handle callback queries (inline button clicks)
          if (update.callback_query) {
            const callbackQueryId = update.callback_query.id;
            const callbackData = update.callback_query.data;
            const chatId = update.callback_query.from?.id;

            // Only respond to callbacks from the configured chat
            if (String(chatId) === String(this.bot.chatId)) {
              await this.handleCallbackQuery(callbackQueryId, callbackData);
            }
            continue;
          }

          // Handle text commands
          const text = update.message?.text;
          const chatId = update.message?.chat?.id;
          // Only respond to messages from the configured chat
          if (text && String(chatId) === String(this.bot.chatId)) {
            await this.handleCommand(text);
          }
        }
      }
    } catch (err) {
      // Silently handle polling errors to avoid log spam
      if (err.code !== "ECONNRESET") {
        console.error("Telegram polling error:", err.message);
      }
    }
  }

  async handleCommand(text) {
    const parts = text.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case "/start":
        await this.bot.sendMessage(
          [
            "\u{1F680} <b>Welcome to NEXUS Trading Bot!</b>",
            "",
            "Your personal Forex & Commodities signal assistant.",
            "",
            "\u{1F4CA} <b>What I do:</b>",
            "  \u2022 Generate BUY/SELL signals using confluence analysis",
            "  \u2022 Track virtual trades with auto SL/TP",
            "  \u2022 Send you real-time alerts when signals fire",
            "  \u2022 Provide performance reports on demand",
            "",
            `\u{1F3AF} <b>Active Pair:</b> ${this.activePair}`,
            `\u{1F514} <b>Alerts:</b> ${this.alertsEnabled ? "ON" : "OFF"}`,
            "",
            "Type /help to see all commands.",
          ].join("\n")
        );
        break;

      case "/status":
        await this.bot.sendMessage(this.tradeManager.getStatusReport());
        break;

      case "/signals":
        await this.bot.sendMessage(this.getRecentSignalsReport());
        break;

      case "/positions":
        await this.bot.sendMessage(
          this.tradeManager.getOpenPositionsReport()
        );
        break;

      case "/performance":
        await this.bot.sendMessage(
          this.tradeManager.getPerformanceReport()
        );
        break;

      case "/market":
        await this.bot.sendMarketStatus(this.getAllPairPrices());
        break;

      case "/daily":
        await this.bot.sendDailySummary(this.tradeManager.getDailyStats());
        break;

      case "/marketstatus": {
        const report = getMarketStatusReport();
        await this.bot.sendMessage(
          `<b>📊 FOREX MARKET STATUS</b>\n\n<pre>${report}</pre>`
        );
        break;
      }

      case "/pair": {
        if (args.length === 0) {
          // Show current pair and available pairs
          const pairList = SUPPORTED_PAIRS.map(
            (p) => `${p === this.activePair ? "\u25B6 " : "  "}${p}`
          ).join("\n");
          await this.bot.sendMessage(
            [
              `\u{1F4B1} <b>ACTIVE PAIR:</b> ${this.activePair}`,
              "",
              "<b>Available pairs:</b>",
              `<pre>${pairList}</pre>`,
              "",
              "<i>Switch with: /pair EUR/USD</i>",
            ].join("\n")
          );
        } else {
          const requested = args[0].toUpperCase();
          // Allow both "EURUSD" and "EUR/USD" formats
          const normalized = requested.includes("/")
            ? requested
            : requested.length === 6
              ? `${requested.slice(0, 3)}/${requested.slice(3)}`
              : requested;

          if (SUPPORTED_PAIRS.includes(normalized)) {
            this.activePair = normalized;
            if (this.onPairChange) this.onPairChange(normalized);
            await this.bot.sendMessage(
              `\u2705 Active pair switched to <b>${normalized}</b>`
            );
          } else {
            await this.bot.sendMessage(
              `\u274C Unknown pair: ${requested}\nSupported: ${SUPPORTED_PAIRS.join(", ")}`
            );
          }
        }
        break;
      }

      case "/alerts": {
        if (args.length === 0) {
          // Toggle
          this.alertsEnabled = !this.alertsEnabled;
        } else if (args[0].toLowerCase() === "on") {
          this.alertsEnabled = true;
        } else if (args[0].toLowerCase() === "off") {
          this.alertsEnabled = false;
        }

        await this.bot.sendMessage(
          `${this.alertsEnabled ? "\u{1F514}" : "\u{1F515}"} Signal alerts are now <b>${this.alertsEnabled ? "ON" : "OFF"}</b>`
        );
        break;
      }

      case "/buy": {
        if (args.length < 2) {
          await this.bot.sendMessage(
            "Usage: /buy [PAIR] [LOTSIZE]\nExample: /buy EUR/USD 0.1"
          );
          return;
        }

        const pair = args[0].toUpperCase().includes("/")
          ? args[0].toUpperCase()
          : args[0].length === 6
            ? `${args[0].slice(0, 3)}/${args[0].slice(3)}`.toUpperCase()
            : args[0].toUpperCase();

        const lotSize = parseFloat(args[1]);

        // Validate
        const validation = this.validateTradeParams(
          pair,
          lotSize,
          this.tradeManager.balance
        );
        if (!validation.valid) {
          await this.bot.sendMessage(`\u274C ${validation.error}`);
          return;
        }

        // Check market hours
        if (!isMarketOpen()) {
          const marketStatus = getMarketStatus();
          await this.bot.sendMessage(
            `⏸️ <b>Markets Closed</b>\n\n` +
            `Cannot execute trade: ${marketStatus.weekend ? "Weekend" : "Between sessions"}\n\n` +
            `Next Open: ${marketStatus.nextEventTime.toUTCString()}`
          );
          return;
        }

        // Get current price (from pairPrices map or fallback to PAIRS config)
        const currentPrice =
          this.pairPrices.get(pair)?.price ||
          require("./trade-manager").PAIRS?.[pair]?.price;

        if (!currentPrice) {
          await this.bot.sendMessage(
            `\u274C Cannot determine current price for ${pair}`
          );
          return;
        }

        // Execute trade
        const position = this.tradeManager.openTrade("BUY", pair, currentPrice, {
          lotSize,
        });
        this.tradeManager.lastPrices.set(pair, currentPrice);

        const digits = position.digits || 4;
        await this.bot.sendMessage(
          [
            `\u2705 <b>BUY Order Placed</b>`,
            ``,
            `<b>${pair}</b>`,
            `Entry: ${position.entry.toFixed(digits)}`,
            `Lot Size: ${lotSize}`,
            `SL: ${position.sl.toFixed(digits)} | TP: ${position.tp.toFixed(digits)}`,
            ``,
            `ID: <code>${position.id}</code>`,
            `Balance: $${this.tradeManager.balance.toFixed(2)}`,
          ].join("\n")
        );

        // Send standard trade update
        await this.bot.sendTradeUpdate({ ...position, pair }, "opened");
        break;
      }

      case "/sell": {
        if (args.length < 2) {
          await this.bot.sendMessage(
            "Usage: /sell [PAIR] [LOTSIZE]\nExample: /sell GBP/USD 0.1"
          );
          return;
        }

        const pair = args[0].toUpperCase().includes("/")
          ? args[0].toUpperCase()
          : args[0].length === 6
            ? `${args[0].slice(0, 3)}/${args[0].slice(3)}`.toUpperCase()
            : args[0].toUpperCase();

        const lotSize = parseFloat(args[1]);

        // Validate
        const validation = this.validateTradeParams(
          pair,
          lotSize,
          this.tradeManager.balance
        );
        if (!validation.valid) {
          await this.bot.sendMessage(`\u274C ${validation.error}`);
          return;
        }

        // Check market hours
        if (!isMarketOpen()) {
          const marketStatus = getMarketStatus();
          await this.bot.sendMessage(
            `⏸️ <b>Markets Closed</b>\n\n` +
            `Cannot execute trade: ${marketStatus.weekend ? "Weekend" : "Between sessions"}\n\n` +
            `Next Open: ${marketStatus.nextEventTime.toUTCString()}`
          );
          return;
        }

        // Get current price
        const currentPrice =
          this.pairPrices.get(pair)?.price ||
          require("./trade-manager").PAIRS?.[pair]?.price;

        if (!currentPrice) {
          await this.bot.sendMessage(
            `\u274C Cannot determine current price for ${pair}`
          );
          return;
        }

        // Execute trade
        const position = this.tradeManager.openTrade("SELL", pair, currentPrice, {
          lotSize,
        });
        this.tradeManager.lastPrices.set(pair, currentPrice);

        const digits = position.digits || 4;
        await this.bot.sendMessage(
          [
            `\u2705 <b>SELL Order Placed</b>`,
            ``,
            `<b>${pair}</b>`,
            `Entry: ${position.entry.toFixed(digits)}`,
            `Lot Size: ${lotSize}`,
            `SL: ${position.sl.toFixed(digits)} | TP: ${position.tp.toFixed(digits)}`,
            ``,
            `ID: <code>${position.id}</code>`,
            `Balance: $${this.tradeManager.balance.toFixed(2)}`,
          ].join("\n")
        );

        // Send standard trade update
        await this.bot.sendTradeUpdate({ ...position, pair }, "opened");
        break;
      }

      case "/close": {
        if (args.length < 1) {
          await this.bot.sendMessage(
            "Usage: /close [POSITION_ID]\nExample: /close 1707412345678\n\nUse /list to see all position IDs."
          );
          return;
        }

        const positionId = parseInt(args[0]);
        const position = this.tradeManager.openPositions.find(
          (p) => p.id === positionId
        );

        if (!position) {
          await this.bot.sendMessage(
            `\u274C Position #${positionId} not found.\n\nUse /list to see open positions.`
          );
          return;
        }

        // Get current price for the pair
        const currentPrice =
          this.pairPrices.get(position.pair)?.price || position.currentPrice;

        const closed = this.tradeManager.closePosition(positionId, currentPrice);

        if (closed) {
          const digits = closed.digits || 4;
          const pnlEmoji = closed.pnl >= 0 ? "\u2705" : "\u274C";

          await this.bot.sendMessage(
            [
              `${pnlEmoji} <b>Position Closed</b>`,
              ``,
              `<b>${closed.type} ${closed.pair}</b>`,
              `Entry: ${closed.entry.toFixed(digits)}`,
              `Exit: ${closed.exit.toFixed(digits)}`,
              ``,
              `P&L: ${closed.pnl >= 0 ? "+" : ""}$${closed.pnl.toFixed(2)} (${closed.pnlPct.toFixed(2)}%)`,
              `Result: ${closed.result}`,
              `Reason: ${closed.exitReason}`,
              ``,
              `Balance: $${closed.balanceAfter.toFixed(2)}`,
            ].join("\n")
          );

          // Send standard trade update
          const eventType =
            closed.result === "WIN" ? "closed_win" : "closed_loss";
          await this.bot.sendTradeUpdate(closed, eventType);
        } else {
          await this.bot.sendMessage("\u274C Failed to close position");
        }
        break;
      }

      case "/closeall": {
        if (args.length < 1) {
          await this.bot.sendMessage(
            "Usage: /closeall [PAIR]\nExample: /closeall EUR/USD\n\nCloses all positions for the specified pair."
          );
          return;
        }

        const pair = args[0].toUpperCase().includes("/")
          ? args[0].toUpperCase()
          : args[0].length === 6
            ? `${args[0].slice(0, 3)}/${args[0].slice(3)}`.toUpperCase()
            : args[0].toUpperCase();

        const matchingPositions = this.tradeManager.openPositions.filter(
          (p) => p.pair === pair
        );

        if (matchingPositions.length === 0) {
          await this.bot.sendMessage(`No open positions found for ${pair}`);
          return;
        }

        let totalPnl = 0;
        let closed = 0;

        for (const pos of matchingPositions) {
          const currentPrice =
            this.pairPrices.get(pos.pair)?.price || pos.currentPrice;
          const closedTrade = this.tradeManager.closePosition(
            pos.id,
            currentPrice
          );

          if (closedTrade) {
            totalPnl += closedTrade.pnl;
            closed++;

            // Send individual trade update
            const eventType =
              closedTrade.result === "WIN" ? "closed_win" : "closed_loss";
            await this.bot.sendTradeUpdate(closedTrade, eventType);
          }
        }

        const emoji = totalPnl >= 0 ? "\u2705" : "\u274C";
        await this.bot.sendMessage(
          [
            `${emoji} <b>Closed All ${pair} Positions</b>`,
            ``,
            `Positions Closed: ${closed}`,
            `Total P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`,
            `Balance: $${this.tradeManager.balance.toFixed(2)}`,
          ].join("\n")
        );
        break;
      }

      case "/closetype": {
        if (args.length < 2) {
          await this.bot.sendMessage(
            "Usage: /closetype [BUY|SELL] [PAIR]\nExample: /closetype BUY EUR/USD\n\nCloses all BUY or SELL positions for the specified pair."
          );
          return;
        }

        const type = args[0].toUpperCase();
        if (type !== "BUY" && type !== "SELL") {
          await this.bot.sendMessage("\u274C Type must be BUY or SELL");
          return;
        }

        const pair = args[1].toUpperCase().includes("/")
          ? args[1].toUpperCase()
          : args[1].length === 6
            ? `${args[1].slice(0, 3)}/${args[1].slice(3)}`.toUpperCase()
            : args[1].toUpperCase();

        const matchingPositions = this.tradeManager.openPositions.filter(
          (p) => p.pair === pair && p.type === type
        );

        if (matchingPositions.length === 0) {
          await this.bot.sendMessage(
            `No open ${type} positions found for ${pair}`
          );
          return;
        }

        let totalPnl = 0;
        let closed = 0;

        for (const pos of matchingPositions) {
          const currentPrice =
            this.pairPrices.get(pos.pair)?.price || pos.currentPrice;
          const closedTrade = this.tradeManager.closePosition(
            pos.id,
            currentPrice
          );

          if (closedTrade) {
            totalPnl += closedTrade.pnl;
            closed++;

            // Send individual trade update
            const eventType =
              closedTrade.result === "WIN" ? "closed_win" : "closed_loss";
            await this.bot.sendTradeUpdate(closedTrade, eventType);
          }
        }

        const emoji = totalPnl >= 0 ? "\u2705" : "\u274C";
        await this.bot.sendMessage(
          [
            `${emoji} <b>Closed All ${type} ${pair} Positions</b>`,
            ``,
            `Positions Closed: ${closed}`,
            `Total P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`,
            `Balance: $${this.tradeManager.balance.toFixed(2)}`,
          ].join("\n")
        );
        break;
      }

      case "/list": {
        if (this.tradeManager.openPositions.length === 0) {
          await this.bot.sendMessage("No open positions.");
          return;
        }

        // Sort by P&L descending
        const sorted = [...this.tradeManager.openPositions].sort(
          (a, b) => b.pnl - a.pnl
        );

        const lines = sorted.map((p) => {
          const idShort = String(p.id).slice(-6);
          const digits = p.digits || 4;
          const pnlStr =
            p.pnl >= 0
              ? `+$${p.pnl.toFixed(2)}`
              : `-$${Math.abs(p.pnl).toFixed(2)}`;
          const pnlPctStr = `${p.pnlPct >= 0 ? "+" : ""}${p.pnlPct.toFixed(2)}%`;
          const duration = Math.floor((Date.now() - p.entryTime) / 60000);

          return [
            `<b>ID:</b> <code>${idShort}</code>`,
            `${p.type} ${p.pair}`,
            `Entry: ${p.entry.toFixed(digits)} \u2192 ${p.currentPrice.toFixed(digits)}`,
            `P&L: ${pnlStr} (${pnlPctStr})`,
            `Duration: ${duration}m`,
          ].join(" | ");
        });

        await this.bot.sendMessage(
          [
            `\u{1F4CA} <b>OPEN POSITIONS</b>`,
            ``,
            ...lines,
            ``,
            `<i>Use /close [ID] to close a position</i>`,
          ].join("\n")
        );
        break;
      }

      case "/price": {
        if (args.length < 1) {
          await this.bot.sendMessage(
            "Usage: /price [PAIR]\nExample: /price XAU/USD"
          );
          return;
        }

        const pair = args[0].toUpperCase().includes("/")
          ? args[0].toUpperCase()
          : args[0].length === 6
            ? `${args[0].slice(0, 3)}/${args[0].slice(3)}`.toUpperCase()
            : args[0].toUpperCase();

        if (!SUPPORTED_PAIRS.includes(pair)) {
          await this.bot.sendMessage(
            `\u274C Unknown pair: ${pair}\n\nSupported pairs:\n${SUPPORTED_PAIRS.join(", ")}`
          );
          return;
        }

        const priceData = this.pairPrices.get(pair);
        const fallbackPrice = require("./trade-manager").PAIRS?.[pair]?.price;

        if (!priceData && !fallbackPrice) {
          await this.bot.sendMessage(
            `\u274C Price data not available for ${pair}`
          );
          return;
        }

        const price = priceData?.price || fallbackPrice;
        const digits =
          priceData?.digits ||
          (pair.includes("JPY") || pair.includes("XAU") ? 2 : 4);
        const changePct = priceData?.changePct || 0;
        const arrow = changePct >= 0 ? "\u25B2" : "\u25BC";

        await this.bot.sendMessage(
          [
            `\u{1F4B1} <b>${pair}</b>`,
            ``,
            `<b>Price:</b> ${price.toFixed(digits)}`,
            `<b>Change:</b> ${arrow} ${Math.abs(changePct).toFixed(3)}%`,
            ``,
            `<i>Updated: ${new Date().toLocaleTimeString()}</i>`,
          ].join("\n")
        );
        break;
      }

      case "/help":
        await this.bot.sendMessage(
          [
            "\u{1F916} <b>NEXUS COMMANDS</b>",
            "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
            "",
            "<b>Info & Monitoring</b>",
            "/start \u2014 Welcome message & bot info",
            "/status \u2014 Balance & system status",
            "/market \u2014 All pair prices overview",
            "/marketstatus \u2014 Check if markets are open",
            "",
            "<b>Trading & Signals</b>",
            "/signals \u2014 Last 5 trade signals",
            "/positions \u2014 Open positions & live P&L",
            "/performance \u2014 Win rate & metrics",
            "/daily \u2014 Today's performance summary",
            "",
            "<b>Remote Trading</b>",
            "/buy [PAIR] [LOT] \u2014 Open BUY position",
            "/sell [PAIR] [LOT] \u2014 Open SELL position",
            "/close [ID] \u2014 Close position by ID",
            "/closeall [PAIR] \u2014 Close all positions for pair",
            "/closetype [BUY|SELL] [PAIR] \u2014 Close by type",
            "/list \u2014 List all open positions with IDs",
            "/price [PAIR] \u2014 Get current market price",
            "",
            "<b>Settings</b>",
            "/pair \u2014 Show active pair",
            "/pair EUR/USD \u2014 Switch active pair",
            "/alerts \u2014 Toggle signal notifications",
            "/alerts on|off \u2014 Set alert state",
            "",
            "/help \u2014 This menu",
          ].join("\n")
        );
        break;

      default:
        if (cmd.startsWith("/")) {
          await this.bot.sendMessage(
            `Unknown command: ${cmd}\nType /help for available commands.`
          );
        }
        break;
    }
  }

  /**
   * Handle inline button callback queries
   * Format: signal_{type}_{pair}_{price}
   * Example: signal_buy_EURUSD_1.1820
   */
  async handleCallbackQuery(callbackQueryId, callbackData) {
    try {
      // Parse callback data
      const parts = callbackData.split("_");
      if (parts[0] !== "signal" || parts.length !== 4) {
        await this.bot.answerCallbackQuery(callbackQueryId, "Invalid action", true);
        return;
      }

      const [_, type, pairNoSlash, priceStr] = parts;

      // Reconstruct pair with slash (e.g., "EURUSD" -> "EUR/USD")
      const pair =
        pairNoSlash.length === 6
          ? `${pairNoSlash.slice(0, 3)}/${pairNoSlash.slice(3)}`
          : pairNoSlash;

      const price = parseFloat(priceStr);
      const tradeType = type.toUpperCase();

      // Validate
      const validation = this.validateTradeParams(pair, 0.1, this.tradeManager.balance);
      if (!validation.valid) {
        await this.bot.answerCallbackQuery(callbackQueryId, validation.error, true);
        return;
      }

      // Check market hours
      if (!isMarketOpen()) {
        await this.bot.answerCallbackQuery(callbackQueryId, "Markets are closed", true);
        const marketStatus = getMarketStatus();
        await this.bot.sendMessage(
          `⏸️ <b>Markets Closed</b>\n\n` +
          `Cannot execute trade via button: ${marketStatus.weekend ? "Weekend" : "Between sessions"}\n\n` +
          `Next Open: ${marketStatus.nextEventTime.toUTCString()}`
        );
        return;
      }

      // Execute trade
      const position = this.tradeManager.openTrade(tradeType, pair, price, {
        lotSize: 0.1,
      });
      this.tradeManager.lastPrices.set(pair, price);

      // Send confirmation
      const digits = position.digits || 4;
      const confirmMsg = [
        `\u2705 <b>Trade Opened</b>`,
        ``,
        `<b>${tradeType} ${pair}</b>`,
        `Entry: ${position.entry.toFixed(digits)}`,
        `Lot Size: ${position.lotSize}`,
        `SL: ${position.sl.toFixed(digits)}`,
        `TP: ${position.tp.toFixed(digits)}`,
        ``,
        `ID: <code>${position.id}</code>`,
        `Balance: $${this.tradeManager.balance.toFixed(2)}`,
      ].join("\n");

      await this.bot.sendMessage(confirmMsg);
      await this.bot.answerCallbackQuery(
        callbackQueryId,
        `${tradeType} order placed!`
      );

      // Also send standard trade update notification
      await this.bot.sendTradeUpdate({ ...position, pair }, "opened");
    } catch (err) {
      console.error("Callback query error:", err.message);
      await this.bot.answerCallbackQuery(
        callbackQueryId,
        "Trade execution failed",
        true
      );
    }
  }

  getRecentSignalsReport() {
    if (this.signalHistory.length === 0) {
      return "No signals generated yet.";
    }

    const recent = this.signalHistory.slice(-5).reverse();
    const lines = recent.map((s) => {
      const emoji = s.type === "BUY" ? "\u{1F7E2}" : "\u{1F534}";
      return `${emoji} ${s.type} ${s.pair || ""} @ ${s.price.toFixed(4)} (${s.confidence.toFixed(0)}%) — ${s.timestamp}`;
    });

    return [`<b>RECENT SIGNALS</b>`, ``, ...lines].join("\n");
  }

  getAllPairPrices() {
    const pairs = [];
    for (const [symbol, data] of this.pairPrices) {
      pairs.push({
        symbol,
        price: data.price,
        change: data.change || 0,
        changePct: data.changePct || 0,
        digits: data.digits || 4,
      });
    }
    return pairs;
  }

  updatePairPrice(symbol, price, prevPrice) {
    const digits = symbol.includes("JPY") || symbol.includes("XAU") ? 2 : 4;
    this.pairPrices.set(symbol, {
      price,
      change: price - (prevPrice || price),
      changePct: prevPrice
        ? ((price - prevPrice) / prevPrice) * 100
        : 0,
      digits,
    });
  }

  /**
   * Validate trade parameters before execution
   * @param {string} pair - Trading pair (e.g., "EUR/USD")
   * @param {number} lotSize - Lot size (0.01-1.0)
   * @param {number} balance - Current account balance
   * @returns {{valid: boolean, error?: string}}
   */
  validateTradeParams(pair, lotSize, balance) {
    // Validate pair
    if (!SUPPORTED_PAIRS.includes(pair)) {
      return {
        valid: false,
        error: `Invalid pair: ${pair}. Supported: ${SUPPORTED_PAIRS.join(", ")}`,
      };
    }

    // Validate lot size
    if (isNaN(lotSize) || lotSize < 0.01 || lotSize > 1.0) {
      return {
        valid: false,
        error: "Lot size must be between 0.01 and 1.0",
      };
    }

    // Validate balance (rough estimate: need at least 1000 * lotSize margin)
    const estimatedMargin = lotSize * 1000;
    if (balance < estimatedMargin) {
      return {
        valid: false,
        error: `Insufficient balance. Need at least $${estimatedMargin.toFixed(2)}`,
      };
    }

    return { valid: true };
  }

  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }
}

module.exports = { TelegramCommandHandler };
