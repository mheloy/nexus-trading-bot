// Module 10 — Telegram Bot
// Sends signal alerts, trade updates, and daily summaries
// Uses Node.js native https with IPv4 to avoid undici/fetch connectivity issues

const https = require("https");

class TelegramBot {
  constructor(token, chatId) {
    this.token = token;
    this.chatId = chatId;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.lastSignalTime = 0;
    this.cooldownMs = 60000; // Min 1 minute between signal alerts
    this.enabled = !!(token && chatId);
  }

  /**
   * Internal HTTP request using native https module (IPv4 forced).
   * Replaces fetch() which fails on some systems due to undici IPv6 issues.
   */
  _fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const reqOptions = {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: options.method || "GET",
        family: 4, // Force IPv4
        headers: options.headers || {},
      };

      const req = https.request(reqOptions, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => Promise.resolve(JSON.parse(data)),
          });
        });
      });

      req.on("error", reject);
      req.setTimeout(10000, () => {
        req.destroy(new Error("Request timeout"));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Register slash commands with Telegram so they appear in the command menu.
   * Call once on startup.
   */
  async registerCommands() {
    if (!this.enabled) return;

    const commands = [
      { command: "start", description: "Welcome message & bot info" },
      { command: "status", description: "Balance & system status" },
      { command: "signals", description: "Last 5 trade signals" },
      { command: "positions", description: "Open positions & live P&L" },
      { command: "performance", description: "Win rate & trading metrics" },
      { command: "market", description: "All pair prices overview" },
      { command: "daily", description: "Today's performance summary" },
      { command: "pair", description: "Show or switch active pair" },
      { command: "alerts", description: "Toggle signal alert notifications" },
      // Remote trading commands
      { command: "buy", description: "Open BUY position [PAIR] [LOT]" },
      { command: "sell", description: "Open SELL position [PAIR] [LOT]" },
      { command: "close", description: "Close position by ID [ID]" },
      { command: "closeall", description: "Close all positions [PAIR]" },
      { command: "closetype", description: "Close by type [BUY|SELL] [PAIR]" },
      { command: "list", description: "List open positions with IDs" },
      { command: "price", description: "Get market price [PAIR]" },
      { command: "help", description: "List all available commands" },
    ];

    try {
      const resp = await this._fetch(`${this.baseUrl}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });
      const result = await resp.json();
      if (result.ok) {
        console.log("Telegram slash commands registered successfully");
      } else {
        console.error("Failed to register Telegram commands:", result.description);
      }
    } catch (err) {
      console.error("Telegram setMyCommands error:", err.message);
    }
  }

  async sendMessage(text, options = {}) {
    if (!this.enabled) return null;

    const body = {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...options,
    };

    try {
      const resp = await this._fetch(`${this.baseUrl}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      if (!result.ok) {
        console.error("Telegram send failed:", result.description);
      }
      return result;
    } catch (err) {
      console.error("Telegram error:", err.message);
      return null;
    }
  }

  /**
   * Send signal alert (BUY/SELL) with inline keyboard buttons
   */
  async sendSignalAlert(signal) {
    if (Date.now() - this.lastSignalTime < this.cooldownMs) return;
    this.lastSignalTime = Date.now();

    const emoji = signal.type === "BUY" ? "\u{1F7E2}" : "\u{1F534}";
    const arrow = signal.type === "BUY" ? "\u2B06\uFE0F" : "\u2B07\uFE0F";
    const digits = signal.digits || 4;

    const message = [
      `${emoji} <b>NEXUS SIGNAL: ${signal.type}</b> ${arrow}`,
      ``,
      `<b>Pair:</b>    ${signal.pair}`,
      `<b>Price:</b>   ${signal.price.toFixed(digits)}`,
      `<b>Confidence:</b> ${signal.confidence.toFixed(0)}%`,
      `<b>Time:</b>    ${signal.timestamp}`,
      ``,
      `<b>Confluence Reasons:</b>`,
      ...signal.reasons.map((r) => `  \u2713 ${r}`),
      ``,
      `<b>Indicators:</b>`,
      `  RSI: ${signal.rsi?.toFixed(1) || "\u2014"}`,
      `  MACD: ${signal.macd?.toFixed(6) || "\u2014"}`,
      ``,
      `<i>SL: ${signal.sl?.toFixed(digits) || "\u2014"} | TP: ${signal.tp?.toFixed(digits) || "\u2014"}</i>`,
    ].join("\n");

    // Add inline keyboard with BUY/SELL buttons
    const pairNoSlash = signal.pair.replace("/", "");
    const reply_markup = {
      inline_keyboard: [
        [
          {
            text: "\u{1F7E2} BUY",
            callback_data: `signal_buy_${pairNoSlash}_${signal.price.toFixed(digits)}`,
          },
          {
            text: "\u{1F534} SELL",
            callback_data: `signal_sell_${pairNoSlash}_${signal.price.toFixed(digits)}`,
          },
        ],
      ],
    };

    await this.sendMessage(message, { reply_markup });
  }

  /**
   * Send trade update (opened, closed, SL/TP hit)
   */
  async sendTradeUpdate(trade, eventType) {
    const emoji = {
      opened: "\u{1F4D6}",
      closed_win: "\u2705",
      closed_loss: "\u274C",
      sl_hit: "\u{1F6D1}",
      tp_hit: "\u{1F3AF}",
    }[eventType] || "\u{1F4CA}";

    const digits = trade.digits || 4;

    const message = [
      `${emoji} <b>TRADE ${eventType.toUpperCase().replace("_", " ")}</b>`,
      ``,
      `<b>${trade.type} ${trade.pair}</b>`,
      `Entry: ${trade.entry.toFixed(digits)}`,
      trade.exit ? `Exit:  ${trade.exit.toFixed(digits)}` : "",
      trade.pnl !== undefined
        ? `P&L:   ${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)} (${trade.pnlPct.toFixed(2)}%)`
        : "",
      trade.balanceAfter
        ? `Balance: $${trade.balanceAfter.toFixed(2)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    await this.sendMessage(message);
  }

  /**
   * Send daily performance summary
   */
  async sendDailySummary(stats) {
    const emoji = stats.netPnl >= 0 ? "\u{1F4C8}" : "\u{1F4C9}";

    const message = [
      `${emoji} <b>NEXUS DAILY SUMMARY</b>`,
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
      ``,
      `<b>Net P&L:</b>     ${stats.netPnl >= 0 ? "+" : ""}$${stats.netPnl.toFixed(2)}`,
      `<b>Trades:</b>      ${stats.totalTrades}`,
      `<b>Win Rate:</b>    ${stats.winRate.toFixed(1)}%`,
      `<b>Wins/Losses:</b> ${stats.wins}/${stats.losses}`,
      `<b>Best Trade:</b>  +$${stats.bestTrade.toFixed(2)}`,
      `<b>Worst Trade:</b> -$${Math.abs(stats.worstTrade).toFixed(2)}`,
      ``,
      `<b>Balance:</b>     $${stats.balance.toFixed(2)}`,
      `<b>Open Positions:</b> ${stats.openPositions}`,
      ``,
      `<i>${stats.signalsGenerated} signals generated today</i>`,
    ].join("\n");

    await this.sendMessage(message);
  }

  /**
   * Send market status overview
   */
  async sendMarketStatus(pairs) {
    const lines = pairs.map((p) => {
      const arrow = p.change >= 0 ? "\u25B2" : "\u25BC";
      return `${p.symbol}: ${p.price.toFixed(p.digits)} ${arrow} ${Math.abs(p.changePct).toFixed(3)}%`;
    });

    const message = [
      `\u{1F4CA} <b>MARKET STATUS</b>`,
      `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
      ...lines,
      ``,
      `<i>Updated: ${new Date().toLocaleTimeString()}</i>`,
    ].join("\n");

    await this.sendMessage(message);
  }

  /**
   * Answer a callback query from inline button
   * Must be called within 10 seconds or Telegram shows loading spinner
   */
  async answerCallbackQuery(callbackQueryId, text, showAlert = false) {
    if (!this.enabled) return null;

    const body = {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    };

    try {
      const resp = await this._fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      if (!result.ok) {
        console.error("Telegram answerCallbackQuery failed:", result.description);
      }
      return result;
    } catch (err) {
      console.error("Telegram answerCallbackQuery error:", err.message);
      return null;
    }
  }
}

module.exports = { TelegramBot };
