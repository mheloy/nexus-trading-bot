// Module 9 — Twelve Data WebSocket Client
// Real-time price streaming with auto-reconnect

const WebSocket = require("ws");

class TwelveDataStream {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.subscribers = new Map(); // symbol -> callback[]
    this.reconnectAttempts = 0;
    this.maxReconnects = 10;
    this.connected = false;
  }

  connect() {
    if (!this.apiKey) {
      console.warn("No Twelve Data API key — WebSocket disabled");
      return;
    }

    this.ws = new WebSocket(
      `wss://ws.twelvedata.com/v1/quotes/price?apikey=${this.apiKey}`
    );

    this.ws.on("open", () => {
      console.log("Twelve Data WebSocket connected");
      this.connected = true;
      this.reconnectAttempts = 0;
      // Re-subscribe to all symbols on reconnect
      for (const symbol of this.subscribers.keys()) {
        this._subscribe(symbol);
      }
    });

    this.ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.event === "price") {
          const callbacks = this.subscribers.get(data.symbol) || [];
          const tick = {
            symbol: data.symbol,
            price: parseFloat(data.price),
            timestamp: data.timestamp * 1000,
            bid: parseFloat(data.bid || data.price),
            ask: parseFloat(data.ask || data.price),
            volume: parseInt(data.day_volume || 0),
          };
          callbacks.forEach((cb) => cb(tick));
        }

        if (data.event === "subscribe-status") {
          console.log(
            `WebSocket subscription: ${data.status} for ${JSON.stringify(data.success || [])}`
          );
        }
      } catch (err) {
        console.error("WebSocket message parse error:", err.message);
      }
    });

    this.ws.on("close", () => {
      this.connected = false;
      if (this.reconnectAttempts < this.maxReconnects) {
        const delay = Math.min(
          30000,
          Math.pow(2, this.reconnectAttempts) * 1000
        );
        console.log(`WebSocket closed. Reconnecting in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
        this.reconnectAttempts++;
      } else {
        console.error("WebSocket: max reconnect attempts reached");
      }
    });

    this.ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
    });
  }

  subscribe(symbol, callback) {
    if (!this.subscribers.has(symbol)) {
      this.subscribers.set(symbol, []);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this._subscribe(symbol);
      }
    }
    this.subscribers.get(symbol).push(callback);
  }

  _subscribe(symbol) {
    this.ws.send(
      JSON.stringify({
        action: "subscribe",
        params: { symbols: symbol },
      })
    );
  }

  unsubscribe(symbol) {
    this.subscribers.delete(symbol);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: "unsubscribe",
          params: { symbols: symbol },
        })
      );
    }
  }

  disconnect() {
    this.maxReconnects = 0;
    this.connected = false;
    this.ws?.close();
  }

  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}

module.exports = { TwelveDataStream };
