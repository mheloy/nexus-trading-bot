import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ComposedChart, AreaChart, BarChart, Area, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Legend,
} from "recharts";

// ── Colors ──
const C = {
  bg: "#0a0e17",
  panel: "#111827",
  panelBorder: "#1e293b",
  accent: "#22d3ee",
  buy: "#10b981",
  sell: "#ef4444",
  text: "#e2e8f0",
  textMuted: "#64748b",
  gold: "#fbbf24",
  purple: "#a78bfa",
};

// ── API Base ──
const API = "/api";

// ── Pair Config ──
const PAIR_OPTIONS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "XAU/USD", "USD/CAD", "AUD/USD",
];
const PAIR_DIGITS = {
  "EUR/USD": 4, "GBP/USD": 4, "USD/JPY": 2,
  "XAU/USD": 2, "USD/CAD": 4, "AUD/USD": 4,
};
function formatPrice(price, pair) {
  const digits = PAIR_DIGITS[pair] || 4;
  return price.toFixed(digits);
}
const TIMEFRAMES = [
  { label: "1M", value: "1min" },
  { label: "5M", value: "5min" },
  { label: "15M", value: "15min" },
  { label: "1H", value: "1h" },
  { label: "4H", value: "4h" },
  { label: "1D", value: "1day" },
];

// ── Panel Component ──
function Panel({ title, children, span = 1 }) {
  return (
    <div style={{
      background: C.panel,
      border: `1px solid ${C.panelBorder}`,
      borderRadius: 8,
      padding: 16,
      gridColumn: `span ${span}`,
    }}>
      {title && (
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          color: C.textMuted,
          textTransform: "uppercase",
          letterSpacing: 1.5,
          marginBottom: 12,
          borderBottom: `1px solid ${C.panelBorder}`,
          paddingBottom: 8,
        }}>{title}</div>
      )}
      {children}
    </div>
  );
}

// ── Stat Card ──
function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: C.bg,
      borderRadius: 6,
      padding: "12px 16px",
      textAlign: "center",
      border: `1px solid ${C.panelBorder}`,
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || C.text }}>{value}</div>
    </div>
  );
}

// ── Button ──
function Btn({ children, onClick, color = C.accent, disabled, small, style: s }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? C.panelBorder : color,
        color: disabled ? C.textMuted : "#fff",
        border: "none",
        borderRadius: 6,
        padding: small ? "6px 12px" : "10px 20px",
        fontSize: small ? 12 : 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "opacity 0.2s",
        ...s,
      }}
    >{children}</button>
  );
}

// ══════════════════════════════════════════
// TAB: Dashboard
// ══════════════════════════════════════════
function DashboardTab({ data, srLevels, signals, balance, openPositions, dataSource, isLive, pair }) {
  const latest = data[data.length - 1];
  const prev = data[data.length - 2];
  const priceChange = latest && prev ? latest.close - prev.close : 0;
  const lastSignal = signals[signals.length - 1];
  const chartData = data.slice(-60);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Latest Signal */}
      <Panel title="Latest Signal">
        {lastSignal ? (
          <div>
            <div style={{
              display: "inline-block",
              padding: "4px 12px",
              borderRadius: 4,
              background: lastSignal.type === "BUY" ? C.buy : C.sell,
              color: "#fff",
              fontWeight: 700,
              fontSize: 16,
              marginBottom: 8,
            }}>{lastSignal.type}</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
              Price: {formatPrice(lastSignal.price, pair)} | Confidence: {lastSignal.confidence.toFixed(0)}%
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>
              {lastSignal.reasons.map((r, i) => (
                <div key={i} style={{ marginBottom: 2 }}>{r}</div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ color: C.textMuted, fontSize: 13 }}>No signals yet. Waiting for confluence...</div>
        )}
      </Panel>

      {/* Session Stats */}
      <Panel title="Session Stats">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <StatCard label="Balance" value={`$${balance.toFixed(2)}`} color={C.accent} />
          <StatCard label="Open Positions" value={openPositions.length} />
          <StatCard label="Signals" value={signals.length} color={C.gold} />
          <StatCard label="Data Source" value={dataSource === "twelvedata" ? "LIVE" : "SIM"} color={dataSource === "twelvedata" ? C.buy : C.gold} />
        </div>
      </Panel>

      {/* Mini Price Chart */}
      <Panel title="Price Action" span={2}>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.accent} stopOpacity={0.3} />
                <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.panelBorder} strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tick={{ fill: C.textMuted, fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis domain={["auto", "auto"]} tick={{ fill: C.textMuted, fontSize: 10 }} width={70} tickFormatter={(v) => formatPrice(v, pair)} />
            <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 6, fontSize: 12 }} />
            <Area type="monotone" dataKey="close" stroke={C.accent} fill="url(#priceGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* S/R Levels */}
      <Panel title="Support & Resistance Levels">
        {srLevels.length > 0 ? srLevels.map((level, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "6px 0",
            borderBottom: i < srLevels.length - 1 ? `1px solid ${C.panelBorder}` : "none",
            fontSize: 13,
          }}>
            <span style={{ color: level.type === "support" ? C.buy : C.sell, fontWeight: 600 }}>
              {level.type === "support" ? "S" : "R"} {formatPrice(level.price, pair)}
            </span>
            <span style={{ color: C.textMuted }}>Strength: {level.strength}</span>
          </div>
        )) : (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Loading S/R levels...</div>
        )}
      </Panel>

      {/* Signal History */}
      <Panel title="Signal History">
        {signals.length > 0 ? signals.slice(-8).reverse().map((s, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "4px 0",
            borderBottom: `1px solid ${C.panelBorder}`,
            fontSize: 12,
          }}>
            <span style={{ color: s.type === "BUY" ? C.buy : C.sell, fontWeight: 600 }}>{s.type}</span>
            <span>{formatPrice(s.price, pair)}</span>
            <span style={{ color: C.textMuted }}>{s.confidence.toFixed(0)}%</span>
            <span style={{ color: C.textMuted }}>{s.timestamp}</span>
          </div>
        )) : (
          <div style={{ color: C.textMuted, fontSize: 13 }}>No signals generated yet</div>
        )}
      </Panel>
    </div>
  );
}

// ══════════════════════════════════════════
// TAB: Charts
// ══════════════════════════════════════════
function ChartsTab({ data, srLevels, signals, pair }) {
  const chartData = data.slice(-100);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Price Chart with S/R + SMAs */}
      <Panel title="Price Action with S/R & Moving Averages" span={2}>
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={chartData}>
            <CartesianGrid stroke={C.panelBorder} strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tick={{ fill: C.textMuted, fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis domain={["auto", "auto"]} tick={{ fill: C.textMuted, fontSize: 10 }} width={70} tickFormatter={(v) => formatPrice(v, pair)} />
            <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 6, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="close" stroke={C.accent} strokeWidth={2} dot={false} name="Price" />
            <Line type="monotone" dataKey="sma20" stroke={C.gold} strokeWidth={1} dot={false} name="SMA 20" strokeDasharray="4 2" />
            <Line type="monotone" dataKey="sma50" stroke={C.purple} strokeWidth={1} dot={false} name="SMA 50" strokeDasharray="4 2" />
            {/* S/R Reference Lines */}
            {srLevels.map((level, i) => (
              <ReferenceLine
                key={i}
                y={level.price}
                stroke={level.type === "support" ? C.buy : C.sell}
                strokeDasharray="6 3"
                strokeOpacity={0.6}
                label={{
                  value: `${level.type === "support" ? "S" : "R"} ${formatPrice(level.price, pair)}`,
                  fill: level.type === "support" ? C.buy : C.sell,
                  fontSize: 10,
                  position: "right",
                }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* RSI Chart */}
      <Panel title="RSI (14)" span={2}>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData}>
            <CartesianGrid stroke={C.panelBorder} strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tick={{ fill: C.textMuted, fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={{ fill: C.textMuted, fontSize: 10 }} width={40} />
            <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 6, fontSize: 12 }} />
            <ReferenceLine y={70} stroke={C.sell} strokeDasharray="4 2" strokeOpacity={0.5} label={{ value: "70", fill: C.sell, fontSize: 10 }} />
            <ReferenceLine y={30} stroke={C.buy} strokeDasharray="4 2" strokeOpacity={0.5} label={{ value: "30", fill: C.buy, fontSize: 10 }} />
            <defs>
              <linearGradient id="rsiGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.purple} stopOpacity={0.3} />
                <stop offset="100%" stopColor={C.purple} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="rsi" stroke={C.purple} fill="url(#rsiGrad)" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* MACD Chart */}
      <Panel title="MACD (12, 26, 9)" span={2}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData}>
            <CartesianGrid stroke={C.panelBorder} strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tick={{ fill: C.textMuted, fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} width={60} tickFormatter={(v) => v.toFixed(5)} />
            <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 6, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="histogram" name="Histogram" fill={C.textMuted}>
              {chartData.map((entry, i) => (
                <rect key={i} fill={entry.histogram >= 0 ? C.buy : C.sell} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="macd" stroke={C.accent} strokeWidth={1.5} dot={false} name="MACD" />
            <Line type="monotone" dataKey="macdSignal" stroke={C.sell} strokeWidth={1.5} dot={false} name="Signal" />
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      {/* Volume chart removed — volume is not used as an indicator in the confluence system */}
    </div>
  );
}

// ══════════════════════════════════════════
// TAB: Virtual Trade
// ══════════════════════════════════════════
function TradeTab({ data, signals, openPositions, balance, pair, onTrade, onClose }) {
  const latest = data[data.length - 1];
  const lastSignal = signals[signals.length - 1];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Trade Controls */}
      <Panel title="Execute Trade">
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.textMuted }}>Current Price</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: C.accent }}>
            {latest ? formatPrice(latest.close, pair) : "—"}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>{pair}</div>
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 16 }}>
          <Btn color={C.buy} onClick={() => onTrade("BUY")} style={{ width: 120 }}>BUY</Btn>
          <Btn color={C.sell} onClick={() => onTrade("SELL")} style={{ width: 120 }}>SELL</Btn>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, textAlign: "center" }}>
          SL: 0.2% | TP: 0.4% | Lot: 0.1
        </div>
      </Panel>

      {/* Indicator Readings */}
      <Panel title="Current Indicators">
        {latest ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>RSI (14)</span>
              <span style={{
                fontWeight: 600,
                color: latest.rsi < 30 ? C.buy : latest.rsi > 70 ? C.sell : C.text,
              }}>{latest.rsi?.toFixed(1) || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>MACD</span>
              <span style={{ fontWeight: 600 }}>{latest.macd?.toFixed(6) || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>MACD Signal</span>
              <span>{latest.macdSignal?.toFixed(6) || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>Histogram</span>
              <span style={{ color: latest.histogram >= 0 ? C.buy : C.sell }}>
                {latest.histogram?.toFixed(6) || "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>SMA 20</span>
              <span>{latest.sma20?.toFixed(4) || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>SMA 50</span>
              <span>{latest.sma50?.toFixed(4) || "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginTop: 8 }}>
              <span style={{ color: C.textMuted }}>Trend</span>
              <span style={{
                fontWeight: 600,
                color: latest.sma20 > latest.sma50 ? C.buy : C.sell,
              }}>{latest.sma20 > latest.sma50 ? "BULLISH" : "BEARISH"}</span>
            </div>
          </div>
        ) : (
          <div style={{ color: C.textMuted }}>Loading...</div>
        )}
      </Panel>

      {/* Open Positions */}
      <Panel title="Open Positions" span={2}>
        {openPositions.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.panelBorder}` }}>
                  {["Type", "Pair", "Entry", "Current", "SL", "TP", "P&L", ""].map(h => (
                    <th key={h} style={{ padding: "8px 6px", textAlign: "left", color: C.textMuted, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openPositions.map(pos => (
                  <tr key={pos.id} style={{ borderBottom: `1px solid ${C.panelBorder}` }}>
                    <td style={{ padding: "8px 6px", color: pos.type === "BUY" ? C.buy : C.sell, fontWeight: 600 }}>{pos.type}</td>
                    <td style={{ padding: "8px 6px" }}>{pos.pair}</td>
                    <td style={{ padding: "8px 6px" }}>{pos.entry.toFixed(pos.digits)}</td>
                    <td style={{ padding: "8px 6px" }}>{pos.currentPrice.toFixed(pos.digits)}</td>
                    <td style={{ padding: "8px 6px", color: C.sell }}>{pos.sl.toFixed(pos.digits)}</td>
                    <td style={{ padding: "8px 6px", color: C.buy }}>{pos.tp.toFixed(pos.digits)}</td>
                    <td style={{ padding: "8px 6px", color: pos.pnl >= 0 ? C.buy : C.sell, fontWeight: 600 }}>
                      {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <Btn small color={C.sell} onClick={() => onClose(pos.id)}>Close</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: C.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>
            No open positions. Use BUY/SELL buttons above to open a trade.
          </div>
        )}
      </Panel>
    </div>
  );
}

// ══════════════════════════════════════════
// TAB: Backtest
// ══════════════════════════════════════════
function BacktestTab({ pair, timeframe }) {
  const [config, setConfig] = useState({
    stopLoss: 0.002,
    takeProfit: 0.004,
    lotSize: 0.1,
    balance: 10000,
  });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const runBacktest = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${API}/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair, timeframe, ...config }),
      });
      const data = await resp.json();
      setResults(data);
    } catch (err) {
      console.error("Backtest error:", err);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Config */}
      <Panel title="Backtest Configuration">
        {[
          { label: "Stop Loss (%)", key: "stopLoss", mult: 100, step: 0.1 },
          { label: "Take Profit (%)", key: "takeProfit", mult: 100, step: 0.1 },
          { label: "Lot Size", key: "lotSize", mult: 1, step: 0.1 },
          { label: "Starting Balance ($)", key: "balance", mult: 1, step: 1000 },
        ].map(({ label, key, mult, step }) => (
          <div key={key} style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: C.textMuted, display: "block", marginBottom: 4 }}>{label}</label>
            <input
              type="number"
              step={step}
              value={(config[key] * mult).toFixed(key === "balance" ? 0 : 1)}
              onChange={e => setConfig(prev => ({ ...prev, [key]: parseFloat(e.target.value) / mult }))}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: C.bg,
                border: `1px solid ${C.panelBorder}`,
                borderRadius: 6,
                color: C.text,
                fontSize: 14,
                outline: "none",
              }}
            />
          </div>
        ))}
        <Btn onClick={runBacktest} disabled={loading} style={{ width: "100%", marginTop: 8 }}>
          {loading ? "Running..." : "Run Backtest"}
        </Btn>
      </Panel>

      {/* Results */}
      <Panel title="Results">
        {results ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <StatCard label="Total Trades" value={results.trades.length} />
            <StatCard label="Win Rate" value={`${results.winRate.toFixed(1)}%`} color={results.winRate >= 50 ? C.buy : C.sell} />
            <StatCard label="Net P&L" value={`$${results.totalPnl.toFixed(2)}`} color={results.totalPnl >= 0 ? C.buy : C.sell} />
            <StatCard label="Profit Factor" value={results.profitFactor === Infinity ? "INF" : results.profitFactor.toFixed(2)} />
            <StatCard label="Avg Win" value={`$${results.avgWin.toFixed(2)}`} color={C.buy} />
            <StatCard label="Avg Loss" value={`$${results.avgLoss.toFixed(2)}`} color={C.sell} />
            <StatCard label="Final Balance" value={`$${results.finalBalance.toFixed(2)}`} color={C.accent} />
            <StatCard label="Max Drawdown" value={`$${results.maxDrawdown.toFixed(2)}`} color={C.sell} />
          </div>
        ) : (
          <div style={{ color: C.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>
            Configure parameters and click "Run Backtest"
          </div>
        )}
      </Panel>

      {/* Equity Curve */}
      {results && results.equityCurve.length > 1 && (
        <Panel title="Equity Curve" span={2}>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={results.equityCurve}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.buy} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={C.buy} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.panelBorder} strokeDasharray="3 3" />
              <XAxis dataKey="trade" tick={{ fill: C.textMuted, fontSize: 10 }} label={{ value: "Trade #", fill: C.textMuted, fontSize: 11, position: "bottom" }} />
              <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} width={70} tickFormatter={v => `$${v.toFixed(0)}`} />
              <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 6, fontSize: 12 }} formatter={(v) => [`$${v.toFixed(2)}`, "Balance"]} />
              <Area type="monotone" dataKey="balance" stroke={C.buy} fill="url(#eqGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* Backtest Trade Log */}
      {results && results.trades.length > 0 && (
        <Panel title="Backtest Trade Log" span={2}>
          <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.panelBorder}`, position: "sticky", top: 0, background: C.panel }}>
                  {["#", "Type", "Entry", "Exit", "P&L", "Result", "Reason", "Balance"].map(h => (
                    <th key={h} style={{ padding: "6px 4px", textAlign: "left", color: C.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.trades.map((t, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.panelBorder}` }}>
                    <td style={{ padding: "6px 4px" }}>{i + 1}</td>
                    <td style={{ padding: "6px 4px", color: t.type === "BUY" ? C.buy : C.sell, fontWeight: 600 }}>{t.type}</td>
                    <td style={{ padding: "6px 4px" }}>{formatPrice(t.entry, pair)}</td>
                    <td style={{ padding: "6px 4px" }}>{formatPrice(t.exit, pair)}</td>
                    <td style={{ padding: "6px 4px", color: t.pnl >= 0 ? C.buy : C.sell, fontWeight: 600 }}>
                      {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: "6px 4px", color: t.result === "WIN" ? C.buy : C.sell }}>{t.result}</td>
                    <td style={{ padding: "6px 4px", color: C.textMuted }}>{t.exitReason}</td>
                    <td style={{ padding: "6px 4px" }}>${t.balanceAfter.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// TAB: Reports
// ══════════════════════════════════════════
function ReportsTab({ balance, tradeLog, stats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Portfolio Overview */}
      <Panel title="Portfolio Overview" span={2}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          <StatCard label="Starting Balance" value="$10,000.00" />
          <StatCard label="Current Balance" value={`$${balance.toFixed(2)}`} color={C.accent} />
          <StatCard label="Net P&L" value={`${stats.totalPnl >= 0 ? "+" : ""}$${stats.totalPnl.toFixed(2)}`} color={stats.totalPnl >= 0 ? C.buy : C.sell} />
          <StatCard label="Return %" value={`${(((balance - 10000) / 10000) * 100).toFixed(2)}%`} color={balance >= 10000 ? C.buy : C.sell} />
          <StatCard label="Open Exposure" value={stats.openPositions} />
        </div>
      </Panel>

      {/* Performance Metrics */}
      <Panel title="Performance Metrics">
        <div style={{ display: "grid", gap: 8 }}>
          {[
            ["Total Trades", stats.totalTrades],
            ["Wins", stats.wins, C.buy],
            ["Losses", stats.losses, C.sell],
            ["Win Rate", `${stats.winRate.toFixed(1)}%`, stats.winRate >= 50 ? C.buy : C.sell],
            ["Best Trade", `+$${stats.bestTrade.toFixed(2)}`, C.buy],
            ["Worst Trade", `$${stats.worstTrade.toFixed(2)}`, C.sell],
            ["Profit Factor", stats.profitFactor === Infinity ? "INF" : stats.profitFactor.toFixed(2)],
          ].map(([label, value, color]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: C.textMuted }}>{label}</span>
              <span style={{ fontWeight: 600, color: color || C.text }}>{value}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* Win/Loss Distribution */}
      <Panel title="Win/Loss Distribution">
        {tradeLog.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tradeLog.map((t, i) => ({ trade: i + 1, pnl: t.pnl }))}>
              <CartesianGrid stroke={C.panelBorder} strokeDasharray="3 3" />
              <XAxis dataKey="trade" tick={{ fill: C.textMuted, fontSize: 10 }} />
              <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} width={60} tickFormatter={v => `$${v.toFixed(0)}`} />
              <Tooltip contentStyle={{ background: C.panel, border: `1px solid ${C.panelBorder}`, borderRadius: 6, fontSize: 12 }} formatter={(v) => [`$${v.toFixed(2)}`, "P&L"]} />
              <ReferenceLine y={0} stroke={C.textMuted} />
              <Bar dataKey="pnl">
                {tradeLog.map((t, i) => (
                  <rect key={i} fill={t.pnl >= 0 ? C.buy : C.sell} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ color: C.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>
            No trades to display
          </div>
        )}
      </Panel>

      {/* Trade History */}
      <Panel title="Complete Trade History" span={2}>
        {tradeLog.length > 0 ? (
          <div style={{ overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.panelBorder}`, position: "sticky", top: 0, background: C.panel }}>
                  {["#", "Pair", "Type", "Entry", "Exit", "P&L", "Result", "Reason", "Balance After"].map(h => (
                    <th key={h} style={{ padding: "8px 6px", textAlign: "left", color: C.textMuted, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...tradeLog].reverse().map((t, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.panelBorder}` }}>
                    <td style={{ padding: "6px" }}>{tradeLog.length - i}</td>
                    <td style={{ padding: "6px" }}>{t.pair}</td>
                    <td style={{ padding: "6px", color: t.type === "BUY" ? C.buy : C.sell, fontWeight: 600 }}>{t.type}</td>
                    <td style={{ padding: "6px" }}>{t.entry.toFixed(t.digits || 4)}</td>
                    <td style={{ padding: "6px" }}>{t.exit.toFixed(t.digits || 4)}</td>
                    <td style={{ padding: "6px", color: t.pnl >= 0 ? C.buy : C.sell, fontWeight: 600 }}>
                      {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                    </td>
                    <td style={{ padding: "6px", color: t.result === "WIN" ? C.buy : C.sell }}>{t.result}</td>
                    <td style={{ padding: "6px", color: C.textMuted }}>{t.exitReason}</td>
                    <td style={{ padding: "6px" }}>${t.balanceAfter.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: C.textMuted, fontSize: 13, textAlign: "center", padding: 40 }}>
            No completed trades yet
          </div>
        )}
      </Panel>
    </div>
  );
}

// ══════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════
function App() {
  // State
  const [pair, setPair] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState("15min");
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState([]);
  const [srLevels, setSrLevels] = useState([]);
  const [signals, setSignals] = useState([]);
  const [isLive, setIsLive] = useState(false);
  const [dataSource, setDataSource] = useState("simulated");
  const [balance, setBalance] = useState(10000);
  const [openPositions, setOpenPositions] = useState([]);
  const [tradeLog, setTradeLog] = useState([]);
  const [stats, setStats] = useState({
    totalTrades: 0, wins: 0, losses: 0, winRate: 0,
    totalPnl: 0, bestTrade: 0, worstTrade: 0, profitFactor: 0,
    openPositions: 0,
  });

  const wsRef = useRef(null);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/candles?pair=${pair}&tf=${timeframe}`);
      const result = await resp.json();
      setData(result.data);
      setSrLevels(result.srLevels);
      setSignals(result.signals);
      setDataSource(result.source);
    } catch (err) {
      console.error("Fetch error:", err);
    }
  }, [pair, timeframe]);

  // Fetch positions
  const fetchPositions = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/positions`);
      const result = await resp.json();
      setOpenPositions(result.open);
      setTradeLog(result.history);
      setBalance(result.balance);
      setStats(result.stats);
    } catch (err) {
      console.error("Positions fetch error:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
    fetchPositions();
  }, [fetchData, fetchPositions]);

  // WebSocket for live updates
  useEffect(() => {
    if (!isLive) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/live`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "refresh") {
        // Full data refresh (e.g. after pair/timeframe switch)
        const d = msg.data;
        if (d.pair) setPair(d.pair); // Update dropdown when pair changes via Telegram
        setData(d.data);
        setSrLevels(d.srLevels);
        setSignals(d.signals);
        setBalance(d.balance);
        setOpenPositions(d.openPositions);
        setDataSource(d.dataSource);
      } else if (msg.type === "tick") {
        const d = msg.data;
        if (d.candle) {
          setData(prev => {
            const updated = [...prev];
            if (updated.length > 0 && updated[updated.length - 1].time === d.candle.time) {
              updated[updated.length - 1] = d.candle;
            } else {
              updated.push(d.candle);
              if (updated.length > 200) updated.shift();
            }
            return updated;
          });
        }
        if (d.srLevels) setSrLevels(d.srLevels);
        if (d.signals?.length > 0) {
          setSignals(prev => [...prev, ...d.signals]);
        }
        if (d.balance !== undefined) setBalance(d.balance);
        if (d.openPositions) setOpenPositions(d.openPositions);
        if (d.closedTrades?.length > 0) {
          setTradeLog(prev => [...prev, ...d.closedTrades]);
          fetchPositions();
        }
      }
    };

    ws.onerror = () => console.error("WebSocket error");
    ws.onclose = () => console.log("WebSocket closed");

    return () => ws.close();
  }, [isLive, fetchPositions]);

  // Periodic position refresh (every 10s when live)
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [isLive, fetchPositions]);

  // Toggle live
  const toggleLive = async () => {
    if (isLive) {
      await fetch(`${API}/live/stop`, { method: "POST" });
      setIsLive(false);
    } else {
      await fetch(`${API}/live/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pair, timeframe }),
      });
      setIsLive(true);
    }
  };

  // Trade actions
  const handleTrade = async (type) => {
    try {
      const resp = await fetch(`${API}/trade/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, pair }),
      });
      const result = await resp.json();
      if (result.position) {
        setOpenPositions(prev => [...prev, result.position]);
        setBalance(result.balance);
      }
    } catch (err) {
      console.error("Trade error:", err);
    }
  };

  const handleClose = async (positionId) => {
    try {
      const resp = await fetch(`${API}/trade/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positionId }),
      });
      const result = await resp.json();
      if (result.closed) {
        setOpenPositions(prev => prev.filter(p => p.id !== positionId));
        setTradeLog(prev => [...prev, result.closed]);
        setBalance(result.balance);
        fetchPositions();
      }
    } catch (err) {
      console.error("Close error:", err);
    }
  };

  const currentPrice = data.length > 0 ? data[data.length - 1].close : 0;
  const prevPrice = data.length > 1 ? data[data.length - 2].close : currentPrice;
  const priceChange = currentPrice - prevPrice;
  const tabs = [
    { key: "dashboard", label: "Dashboard" },
    { key: "charts", label: "Charts" },
    { key: "trade", label: "Virtual Trade" },
    { key: "backtest", label: "Backtest" },
    { key: "reports", label: "Reports" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      {/* Header */}
      <div style={{
        background: C.panel,
        borderBottom: `1px solid ${C.panelBorder}`,
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {/* Logo */}
          <div style={{ fontSize: 20, fontWeight: 800, color: C.accent, letterSpacing: 2 }}>NEXUS</div>

          {/* Pair Selector */}
          <select
            value={pair}
            onChange={e => {
              const newPair = e.target.value;
              setPair(newPair);
              if (isLive) {
                fetch(`${API}/live/switch`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ pair: newPair, timeframe }),
                });
              }
              // Non-live re-fetch handled by useEffect on [fetchData]
            }}
            style={{
              background: C.bg,
              border: `1px solid ${C.panelBorder}`,
              borderRadius: 6,
              color: C.text,
              padding: "6px 12px",
              fontSize: 13,
              outline: "none",
              cursor: "pointer",
            }}
          >
            {PAIR_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Timeframe Selector */}
          <div style={{ display: "flex", gap: 4 }}>
            {TIMEFRAMES.map(tf => (
              <button
                key={tf.value}
                onClick={() => {
                  setTimeframe(tf.value);
                  if (isLive) {
                    fetch(`${API}/live/switch`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ pair, timeframe: tf.value }),
                    });
                  } else {
                    setTimeout(fetchData, 100);
                  }
                }}
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: timeframe === tf.value ? C.accent : "transparent",
                  color: timeframe === tf.value ? "#000" : C.textMuted,
                  border: `1px solid ${timeframe === tf.value ? C.accent : C.panelBorder}`,
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >{tf.label}</button>
            ))}
          </div>

          {/* Live Toggle */}
          <Btn
            color={isLive ? C.sell : C.buy}
            onClick={toggleLive}
            small
          >
            {isLive ? "STOP" : "LIVE"}
          </Btn>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Current Price */}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>
              {currentPrice ? formatPrice(currentPrice, pair) : "—"}
            </div>
            <div style={{ fontSize: 11, color: priceChange >= 0 ? C.buy : C.sell }}>
              {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(PAIR_DIGITS[pair] === 2 ? 2 : 5)}
            </div>
          </div>

          {/* Balance */}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.textMuted }}>Balance</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.accent }}>${balance.toFixed(2)}</div>
          </div>

          {/* Data Source Badge */}
          <div style={{
            padding: "4px 10px",
            borderRadius: 12,
            fontSize: 10,
            fontWeight: 700,
            background: dataSource === "twelvedata" ? `${C.buy}20` : `${C.gold}20`,
            color: dataSource === "twelvedata" ? C.buy : C.gold,
            border: `1px solid ${dataSource === "twelvedata" ? C.buy : C.gold}`,
          }}>
            {dataSource === "twelvedata" ? "LIVE" : "SIM"}
          </div>

          {/* Live Indicator */}
          {isLive && (
            <div style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: C.sell,
              animation: "pulse 1.5s infinite",
            }} />
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{
        background: C.panel,
        borderBottom: `1px solid ${C.panelBorder}`,
        padding: "0 24px",
        display: "flex",
        gap: 0,
      }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "12px 20px",
              fontSize: 13,
              fontWeight: 600,
              background: "transparent",
              color: tab === t.key ? C.accent : C.textMuted,
              border: "none",
              borderBottom: tab === t.key ? `2px solid ${C.accent}` : "2px solid transparent",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ padding: 24 }}>
        {tab === "dashboard" && (
          <DashboardTab
            data={data}
            srLevels={srLevels}
            signals={signals}
            balance={balance}
            openPositions={openPositions}
            dataSource={dataSource}
            isLive={isLive}
            pair={pair}
          />
        )}
        {tab === "charts" && (
          <ChartsTab data={data} srLevels={srLevels} signals={signals} pair={pair} />
        )}
        {tab === "trade" && (
          <TradeTab
            data={data}
            signals={signals}
            openPositions={openPositions}
            balance={balance}
            pair={pair}
            onTrade={handleTrade}
            onClose={handleClose}
          />
        )}
        {tab === "backtest" && (
          <BacktestTab pair={pair} timeframe={timeframe} />
        )}
        {tab === "reports" && (
          <ReportsTab balance={balance} tradeLog={tradeLog} stats={stats} />
        )}
      </div>

      {/* Global Styles */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        select option { background: ${C.bg}; color: ${C.text}; }
        input:focus { border-color: ${C.accent} !important; }
      `}</style>
    </div>
  );
}

// ── Mount ──
createRoot(document.getElementById("root")).render(<App />);
