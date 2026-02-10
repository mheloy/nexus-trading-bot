# NEXUS Trading Bot — Development Blueprint (v3.0)

> Self-contained blueprint for Claude Code sessions. Attach this file to any new session to rebuild or extend the system.
>
> **Stack**: React JSX (frontend) · Node.js Express (backend) · Recharts · Twelve Data API · Telegram Bot API  
> **Updated**: February 2026

---

## 1. Project Overview

A **signal-generating trading assistant** for Forex & Commodities. It tells you when to BUY or SELL based on triple-confluence technical analysis, sends alerts to Telegram, and lets you execute virtual trades from your phone.

**Core principles**: Confluence over single indicators · S/R is primary · Trend-following · Backtest = live logic (zero divergence) · Full signal transparency with reasoning.

---

## 2. Architecture

**Two-process model:**

- **Frontend (React JSX)**: Dashboard UI, charts, virtual trading, backtest viewer. Communicates with backend via REST + WebSocket.
- **Backend (Node.js)**: Twelve Data API client, Telegram bot, signal engine, trade manager. Protects API keys from frontend exposure.

```
Twelve Data API ──► Backend (Node.js) ──► Frontend (React)
                        │
                        ├──► Telegram Bot (alerts + commands + remote trading)
                        ├──► Signal Engine (confluence scoring)
                        └──► Trade Manager (positions, SL/TP, P&L)
```

**State** lives in top-level React `useState`. Key entries: `pair`, `timeframe`, `data[]`, `srLevels[]`, `signals[]`, `isLive`, `dataSource` ("twelvedata"|"simulated"), `balance`, `openPositions[]`, `tradeLog[]`, `backtestResults`, `telegramStatus`.

**File structure:**
```
nexus-trading-bot/
├── .env / .env.example / .gitignore
├── server/
│   ├── index.js              # Express entry + WebSocket server
│   ├── twelvedata.js         # REST client (candles, indicators)
│   ├── websocket-client.js   # Twelve Data WebSocket stream
│   ├── candle-aggregator.js  # Tick → OHLCV conversion
│   ├── telegram.js           # Outbound messages (alerts, summaries)
│   ├── telegram-commands.js  # Inbound command handler + trade execution
│   ├── scheduler.js          # Daily summary cron
│   ├── signal-engine.js      # Confluence scoring (same logic as frontend)
│   ├── trade-manager.js      # Position state, SL/TP, P&L calc
│   └── indicators.js         # SMA, EMA, RSI, MACD, S/R
├── frontend/
│   ├── trading-bot.jsx       # Single-file React dashboard
│   └── index.html
└── data/
    ├── trades.json           # Persisted trade history
    └── cache/                # Cached Twelve Data responses
```

---

## 3. Module 1 — Market Data Engine

**Primary source**: Twelve Data API. **Fallback**: Simulated data (auto when no API key or on error).

**Supported pairs**: EUR/USD, GBP/USD, USD/JPY, XAU/USD (Gold), USD/CAD, AUD/USD.

**Timeframe mapping**: 1M→`1min`, 5M→`5min`, 15M→`15min`, 1H→`1h`, 4H→`4h`, 1D→`1day`.

**Standard candle shape** (all sources normalize to this): `{ time, timestamp, open, high, low, close, volume }`.

**Simulated fallback** uses three-layer movement: trend (`sin(i/30)*vol*3`), noise (`random()*vol*2`), momentum (`sin(i/15)*vol`). UI shows badge indicating data source.

---

## 4. Module 2 — Technical Analysis Core

All indicator functions are **pure**: data array in, number array out. Returns `null` for candles with insufficient lookback.

| Indicator | Function | Key Details |
|-----------|----------|-------------|
| **SMA** | `calcSMA(data, period)` | Simple average over `period` closes. Used: SMA 20 + SMA 50 for trend direction. |
| **EMA** | `calcEMA(data, period)` | Weighted average, `k = 2/(period+1)`. Seeded with SMA. Used internally by MACD. |
| **RSI** | `calcRSI(data, 14)` | `100 - 100/(1+RS)` where RS = avg gain / avg loss. Range 0–100. <30 = oversold, >70 = overbought. |
| **MACD** | `calcMACD(data)` | Line = EMA(12) - EMA(26). Signal = EMA(9) of line. Histogram = line - signal. Crossovers = trend shifts. |
| **S/R** | `calcSupportResistance(data, 20)` | Detect pivot highs/lows within lookback window. Cluster nearby levels (0.2% threshold). Rank by touch count. Return top 6. |

---

## 5. Module 3 — Signal Generator (Confluence System)

Combines three scores. Only fires when `|totalScore| ≥ 3` AND `confidence ≥ 40%`.

**S/R Score**: Price within 0.3% of support → `+strength`. Near resistance → `-strength`.

**RSI Score**: <30 → +2, <40 → +1, >60 → -1, >70 → -2.

**MACD Score**: Bullish crossover → +2, bearish crossover → -2. Growing histogram → ±0.5.

**Confidence**: `min(100, |totalScore| × 20)`.

**Output per signal**: `{ index, time, timestamp, type (BUY|SELL), price, confidence, reasons[], rsi, macd, macdSignal }`.

**Why this combination**: S/R = *where* to trade (structure), RSI = *when* momentum is exhausted, MACD = *which direction* trend confirms. Three different dimensions = minimal redundancy.

---

## 6. Module 4 — Virtual Trading Engine

**Execution**: User clicks BUY/SELL (dashboard or Telegram) → create position with entry price, SL (entry ± 0.2%), TP (entry ± 0.4%), lot size.

**Live management**: Each tick recalculates P&L. Auto-closes on SL/TP hit. Moves closed position to `tradeLog[]`. Updates balance.

**P&L formula**: `(priceDiff) × lotSize × 100000`. BUY: `current - entry`. SELL: `entry - current`.

**Position object**: `{ id, type, pair, entry, lotSize, sl, tp, currentPrice, pnl, pnlPct }`. On close adds: `exit, result (WIN|LOSS), exitReason (Stop Loss|Take Profit|Manual Close)`.

---

## 7. Module 5 — Backtesting Engine

Runs `generateSignals()` — **identical function** to live — against 500 candles of historical data. Configurable: `stopLoss`, `takeProfit`, `lotSize`, `startBalance`.

**Walk-forward**: For each candle, check if open position hits SL/TP, then check for new signal entry.

**Output metrics**: trades[], wins, losses, totalPnl, winRate, avgWin, avgLoss, profitFactor (`grossProfit/grossLoss`), maxDrawdown, equityCurve[].

**Consistency guarantee**: Any change to signal logic automatically applies to both live and backtest.

---

## 8. Module 6 — Charting & Visualization

Uses **Recharts** (React D3 wrapper). All charts show last 80 candles by default.

| Chart | Type | Key Elements |
|-------|------|-------------|
| Price + S/R | ComposedChart | Close line, SMA 20/50, S/R as dashed ReferenceLine (green=support, red=resistance) |
| RSI | AreaChart | RSI line with gradient fill, reference lines at 30 (green) and 70 (red) |
| MACD | ComposedChart | MACD line + signal line + histogram bars, zero reference line |
| Volume | BarChart | Volume bars |
| Equity Curve | AreaChart | Balance progression from backtest, starting balance reference line |
| Win/Loss | BarChart | Per-trade P&L bars (green positive, red negative) |

**Color scheme**: bg `#0a0e17`, panel `#111827`, accent `#22d3ee` (cyan), buy `#10b981` (green), sell `#ef4444` (red), gold `#fbbf24`, purple `#a78bfa`.

---

## 9. Module 7 — Reporting & Performance Analytics

**Portfolio overview** (5 cards): Starting balance, current balance, net P&L, return %, open exposure count.

**Performance metrics** from `tradeLog[]`: Total/winning/losing trades, win rate, best/worst trade, average P&L.

**Trade history table**: Columns — #, Pair, Type, Entry, Exit, P&L, Result, Reason, Balance After.

---

## 10. Module 8 — UI Shell & Navigation

**Tabs**: Dashboard (at-a-glance), Charts (full TA), Virtual Trade (execution), Backtest (validation), Reports (performance).

**Header bar**: Pair selector, timeframe selector, LIVE toggle (▶/■), current price + change, balance, data source badge, live indicator dot.

**Design**: Dark terminal aesthetic, monospace font (JetBrains Mono), reusable `<Panel title="" span={}>` wrapper for all sections.

---

## 11. Module 9 — Twelve Data Integration

### 11.1 REST API — Historical Data

**Endpoint**: `GET /time_series?symbol={pair}&interval={tf}&outputsize=200&apikey={key}&timezone=UTC`

**Critical**: Response returns newest-first — always `.reverse()` before feeding to TA Core.

**Rate limiting**: Implement exponential backoff on HTTP 429 (1s, 2s, 4s, max 3 retries).

### 11.2 REST API — Built-in Indicators

Endpoints: `/rsi`, `/macd`, `/sma`, `/ema` — same params as time_series plus `time_period`. Use for **cross-validation only** (local calc is primary — faster, no API cost). Log discrepancies above 1%.

### 11.3 WebSocket — Real-Time Feed

**Endpoint**: `wss://ws.twelvedata.com/v1/quotes/price?apikey={key}`

**Subscribe**: `{ action: "subscribe", params: { symbols: "EUR/USD" } }`.

**On message**: Parse `event === "price"`, extract `{ symbol, price, timestamp, bid, ask, day_volume }`.

**Reconnection**: Auto-reconnect with exponential backoff (max 30s, max 10 attempts). Re-subscribe all symbols on reconnect.

### 11.4 Candle Aggregation

`CandleAggregator` class converts raw ticks into OHLCV candles based on interval. Tracks `currentCandle` (in-progress) and `candles[]` (completed). On each tick: if new interval window → push current to completed, start new. Else → update high/low/close/volume.

### 11.5 Fallback Logic

If no `TWELVEDATA_API_KEY` or API error → return `{ source: "simulated", data: generateSimulatedData() }`. Transparent to all downstream modules.

### 11.6 Best Practices

- Always normalize Twelve Data responses to the standard candle shape before passing downstream
- Cache historical requests to avoid redundant API calls on pair/timeframe switches
- Use `outputsize` parameter wisely — 200 for charting, up to 5000 for backtesting
- Monitor API credit usage via Twelve Data dashboard (especially on Starter plans)
- WebSocket symbols count toward plan limits — unsubscribe pairs when switching

---

## 12. Module 10 — Telegram Bot Integration

### 12.1 Setup

1. Message `@BotFather` → `/newbot` → save **Bot Token**
2. Send any message to your bot → visit `https://api.telegram.org/bot<TOKEN>/getUpdates` → save **Chat ID**
3. Add both to `.env`

### 12.2 Outbound Notifications

**Signal alert**: Fires on new BUY/SELL signal. Includes: pair, price, confidence, reasons, RSI, MACD, SL/TP. 60-second cooldown between alerts. Includes **inline keyboard buttons** (BUY / SELL) for one-tap trade execution.

**Trade update**: Fires on position open, close (win/loss), SL hit, TP hit. Includes entry/exit price, P&L, balance after.

**Daily summary**: Scheduled at configurable UTC hour. Includes: net P&L, trade count, win rate, wins/losses, best/worst trade, balance, open positions, signals generated.

**Market status**: All pair prices with change arrows and percentages.

### 12.3 Informational Commands

| Command | Response |
|---------|----------|
| `/status` | Balance, open position count, data source, system uptime |
| `/signals` | Last 5 generated signals with type, price, confidence, time |
| `/positions` | All open positions with IDs, entry, current price, live P&L |
| `/performance` | Win rate, total P&L, trade count, profit factor |
| `/market` | All pair prices with change % |
| `/daily` | Today's performance summary |
| `/help` | Full command menu |

### 12.4 Remote Trading Commands

Execute trades directly from Telegram without opening the dashboard.

| Command | Usage | Description |
|---------|-------|-------------|
| `/buy [PAIR] [LOTSIZE]` | `/buy EUR/USD 0.1` | Open a BUY position |
| `/sell [PAIR] [LOTSIZE]` | `/sell GBP/USD 0.1` | Open a SELL position |
| `/close [ID]` | `/close 1707412345678` | Close a specific position by ID |
| `/closeall [PAIR]` | `/closeall EUR/USD` | Close all positions for a pair |
| `/closetype [BUY\|SELL] [PAIR]` | `/closetype BUY EUR/USD` | Close all BUY or SELL positions for a pair |
| `/list` | `/list` | List all open positions with IDs and live P&L |
| `/price [PAIR]` | `/price XAU/USD` | Get current market price for a pair |

### 12.5 Remote Trading Requirements

**Inline buttons on signals**: Attach `InlineKeyboardMarkup` with BUY/SELL buttons to every signal alert. Handle `callback_query` — answer callback, execute trade, send confirmation. Must respond within 10s or Telegram shows loading spinner.

**Trade execution flow**: Parse command → validate pair exists → validate lot size (0.01–1.0) → check sufficient balance → fetch current price → create position → send confirmation with trade details (ID, entry, SL, TP).

**Safety validations** (enforce on every trade command):
- Pair must exist in supported pairs list
- Lot size must be between 0.01 and 1.0
- Balance must cover the position
- Position ID must exist for `/close`
- Clear error messages on validation failure

**`/close` flow**: Calculate final P&L at current price → remove from `openPositions` → add to `tradeLog` → update balance → send confirmation with P&L. `/closeall` and `/closetype` iterate matching positions, close sequentially, send summary.

**`/list` format**: Each position shows — ID (last 6 digits), pair, type, entry, current price, P&L ($), P&L (%), duration. Sorted by P&L descending.

### 12.6 Alert Trigger Rules

| Event | Alert? | Cooldown |
|-------|--------|----------|
| New signal | ✅ | 60s min between |
| Position opened/closed | ✅ | None |
| SL/TP hit | ✅ | None |
| Price tick | ❌ | Too frequent |
| Daily summary | ✅ | Once/day (scheduled) |
| WS reconnect warning | ✅ | 5 min between |

### 12.7 Best Practices

- All messages use HTML parse mode (`<b>`, `<i>`, `<code>`)
- Command handler uses long-polling (`getUpdates` every 2s) — simpler than webhooks for personal bots
- Only respond to messages from the configured `TELEGRAM_CHAT_ID` (security: ignore all others)
- Log all trade commands with timestamp for audit trail
- Rate-limit outbound messages to stay under Telegram's 30 msg/sec limit

---

## 13. Indicator Research Rationale

| Indicator | Dimension | Why Chosen | Weakness Covered By |
|-----------|-----------|-----------|-------------------|
| **S/R** (Primary) | Structure — *where* to trade | Represents institutional order flow; forward-looking | RSI + MACD (levels can break) |
| **RSI** (Confirm #1) | Momentum — *when* exhausted | Bounded 0–100, effective at extremes | MACD (RSI lingers in trends) |
| **MACD** (Confirm #2) | Trend — *which direction* | Shows both direction + momentum acceleration | S/R (whipsaws in ranges) |

**Rejected alternatives**: Bollinger Bands (overlaps S/R), Stochastic (overlaps RSI), Fibonacci (subjective), Ichimoku (too complex for scoring), ADX (no direction), Volume Profile (unreliable in Forex).

---

## 14. Configuration Reference

### Indicators

| Parameter | Default | Tuning Effect |
|-----------|---------|---------------|
| RSI Period | 14 | Lower = more sensitive. Higher = smoother. |
| MACD (Fast/Slow/Signal) | 12/26/9 | Standard. Lower fast = more responsive. |
| SMA Short/Long | 20/50 | Trend reference lines |
| S/R Lookback | 20 candles | Higher = fewer, stronger levels |
| S/R Cluster Threshold | 0.2% | Higher = more merging |

### Signals

| Parameter | Default | Tuning Effect |
|-----------|---------|---------------|
| Score threshold | ±3 | Lower = more signals. Higher = stricter. |
| Confidence minimum | 40% | Lower = allows weaker signals. |
| S/R proximity | 0.3% | Lower = tighter zone around level. |

### Trading

| Parameter | Default |
|-----------|---------|
| Stop Loss | 0.2% of entry |
| Take Profit | 0.4% of entry (2:1 RR) |
| Lot Size | 0.1 (mini lot) |
| Starting Balance | $10,000 |

### Twelve Data

| Parameter | Default |
|-----------|---------|
| Output Size | 200 candles (charting), 5000 (backtest) |
| Rate Limit Retries | 3 (exponential backoff) |
| WS Reconnect Attempts | 10 (max 30s backoff) |

### Telegram

| Parameter | Default |
|-----------|---------|
| Signal Cooldown | 60s |
| Polling Interval | 2000ms |
| Daily Summary | 23:00 UTC |
| Lot Size Range | 0.01–1.0 |

---

## 15. Environment Variables

```bash
# .env (never commit — add to .gitignore)
TWELVEDATA_API_KEY=           # From https://twelvedata.com/account/api-keys
TELEGRAM_BOT_TOKEN=           # From @BotFather → /newbot
TELEGRAM_CHAT_ID=             # From /getUpdates after messaging your bot
PORT=3001                     # Backend server port
DAILY_SUMMARY_HOUR=23         # UTC hour for daily Telegram report
NODE_ENV=production           # "development" for verbose logging
```

**Security checklist**: `.env` in `.gitignore` · API keys never in frontend code · Backend proxies all external API calls · Telegram bot only responds to configured chat ID · Server on localhost or behind auth · Never hard-fail on missing optional credentials (log warning, use fallback).

---

## 16. Extension Roadmap

### Done ✅
- Twelve Data REST + WebSocket integration with fallback
- Telegram alerts, summaries, command interface
- Telegram remote trading (/buy, /sell, /close, /closeall, /closetype, /list, /price)
- Inline keyboard buttons on signal alerts

### Next
- [ ] ATR-based dynamic SL/TP
- [ ] Multi-timeframe analysis (4H trend → 15M entry)
- [ ] Candlestick pattern recognition at S/R levels
- [ ] Historical data caching (SQLite/JSON)
- [ ] Browser push + sound alerts
- [ ] Trailing stop-loss · Partial close (TP1 + TP2)
- [ ] Risk management (position sizing by account %)
- [ ] Correlation matrix · News calendar warnings
- [ ] Claude API NLP chart analysis via Telegram
- [ ] Strategy comparison (parallel backtest)

---

## 17. Prompt for Claude Code

> I want to build (or extend) a personal Forex & Commodities trading signal bot called NEXUS. The complete blueprint is attached — follow it exactly for architecture, indicator logic, and module structure.
>
> **System**: React JSX frontend + Node.js backend. Twelve Data API for live data (auto-fallback to simulated). Telegram bot for alerts + remote trading.
>
> **Strategy**: Triple-confluence — S/R (primary) + RSI (14) + MACD (12,26,9). Signal fires when `|score| ≥ 3` and `confidence ≥ 40%`.
>
> **10 Modules**: (1) Market Data/Twelve Data, (2) TA Core, (3) Signal Generator, (4) Virtual Trading, (5) Backtesting, (6) Charting, (7) Reporting, (8) UI Shell, (9) Twelve Data Integration, (10) Telegram Bot (alerts + commands + remote trading).
>
> **Env vars**: `TWELVEDATA_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
>
> **Current task**: [describe what you want to build, modify, or add]

**Session tips**: Reference modules by number/name · Specify backend vs frontend · Ask for backtest validation after signal logic changes · Never paste real API keys.
