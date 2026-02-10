// Module 10 — Scheduler
// Sends daily performance summary at a configurable UTC hour

class Scheduler {
  constructor(bot, tradeManager) {
    this.bot = bot;
    this.tradeManager = tradeManager;
    this.interval = null;
    this.lastSentDate = null;
  }

  /**
   * Start the daily summary scheduler
   * @param {number} hour - UTC hour to send summary (0-23)
   * @param {number} minute - UTC minute (default 0)
   */
  start(hour = 23, minute = 0) {
    if (!this.bot.enabled) {
      console.log("Telegram not configured — scheduler disabled");
      return;
    }

    console.log(
      `Daily summary scheduled for ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`
    );

    // Check every minute
    this.interval = setInterval(() => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);

      if (
        now.getUTCHours() === hour &&
        now.getUTCMinutes() === minute &&
        this.lastSentDate !== today
      ) {
        this.lastSentDate = today;
        this.sendSummary();
      }
    }, 60000);
  }

  async sendSummary() {
    try {
      const stats = this.tradeManager.getDailyStats();
      await this.bot.sendDailySummary(stats);
      console.log("Daily summary sent via Telegram");
      // Reset daily counters after sending
      this.tradeManager.resetDaily();
    } catch (err) {
      console.error("Failed to send daily summary:", err.message);
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

module.exports = { Scheduler };
