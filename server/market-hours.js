// Market Hours Module
// Validates if major forex markets are open for trading

/**
 * Major Forex Trading Sessions (UTC)
 * - Sydney (Australia): 22:00 - 07:00
 * - Tokyo (Japan):      00:00 - 09:00
 * - London:             08:00 - 17:00
 * - New York (USA):     13:00 - 22:00
 *
 * Markets are closed weekends (Sat-Sun)
 * Trading window: Sunday 22:00 UTC → Friday 22:00 UTC
 */

const SESSIONS = {
  SYDNEY: { name: "Sydney", open: 22, close: 7 },
  TOKYO: { name: "Tokyo", open: 0, close: 9 },
  LONDON: { name: "London", open: 8, close: 17 },
  NEW_YORK: { name: "New York", open: 13, close: 22 },
};

/**
 * Check if a specific session is currently active
 * @param {Date} now - Current time
 * @param {Object} session - Session config { open, close }
 * @returns {boolean}
 */
function isSessionActive(now, session) {
  const hour = now.getUTCHours();

  // Handle sessions that cross midnight (e.g., Sydney 22:00-07:00)
  if (session.open > session.close) {
    return hour >= session.open || hour < session.close;
  }

  // Normal session within same day
  return hour >= session.open && hour < session.close;
}

/**
 * Check if it's currently the weekend (markets closed)
 * Forex closes Friday 22:00 UTC and reopens Sunday 22:00 UTC
 * @param {Date} now - Current time
 * @returns {boolean}
 */
function isWeekend(now) {
  const day = now.getUTCDay(); // 0 = Sunday, 6 = Saturday
  const hour = now.getUTCHours();

  // Saturday (all day)
  if (day === 6) return true;

  // Sunday before 22:00 UTC
  if (day === 0 && hour < 22) return true;

  // Friday after 22:00 UTC
  if (day === 5 && hour >= 22) return true;

  return false;
}

/**
 * Get all currently active trading sessions
 * @param {Date} now - Current time
 * @returns {Array<string>} Array of active session names
 */
function getActiveSessions(now) {
  if (isWeekend(now)) return [];

  const active = [];

  for (const [key, session] of Object.entries(SESSIONS)) {
    if (isSessionActive(now, session)) {
      active.push(session.name);
    }
  }

  return active;
}

/**
 * Check if ANY major forex market is currently open
 * @param {Date} now - Current time (defaults to now)
 * @returns {boolean}
 */
function isMarketOpen(now = new Date()) {
  if (isWeekend(now)) return false;

  // Check if at least one session is active
  return Object.values(SESSIONS).some(session => isSessionActive(now, session));
}

/**
 * Get comprehensive market status
 * @param {Date} now - Current time
 * @returns {Object} { open, activeSessions[], nextOpen, nextClose }
 */
function getMarketStatus(now = new Date()) {
  const open = isMarketOpen(now);
  const activeSessions = getActiveSessions(now);
  const weekend = isWeekend(now);

  let nextEvent = null;
  let nextEventTime = null;

  if (weekend) {
    nextEvent = "Market Opens";
    nextEventTime = getNextMarketOpen(now);
  } else if (!open) {
    // Weekday but between sessions (rare - only 22:00-00:00 UTC gap)
    nextEvent = "Market Opens";
    nextEventTime = getNextMarketOpen(now);
  } else {
    nextEvent = "Market Closes";
    nextEventTime = getNextMarketClose(now);
  }

  return {
    open,
    weekend,
    activeSessions,
    nextEvent,
    nextEventTime,
  };
}

/**
 * Get the next time markets will open
 * @param {Date} now - Current time
 * @returns {Date}
 */
function getNextMarketOpen(now = new Date()) {
  const next = new Date(now);
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // If it's before Sunday 22:00 UTC, that's the next open
  if (day === 0 && hour < 22) {
    next.setUTCHours(22, 0, 0, 0);
    return next;
  }

  // If it's Friday after 22:00 or Saturday, next open is Sunday 22:00
  if (day === 5 && hour >= 22 || day === 6) {
    const daysUntilSunday = day === 6 ? 1 : 2;
    next.setUTCDate(next.getUTCDate() + daysUntilSunday);
    next.setUTCHours(22, 0, 0, 0);
    return next;
  }

  // During weekday gap (22:00-00:00 UTC), next open is midnight
  if (hour >= 22) {
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
    return next;
  }

  // Otherwise market is already open
  return next;
}

/**
 * Get the next time markets will close
 * @param {Date} now - Current time
 * @returns {Date}
 */
function getNextMarketClose(now = new Date()) {
  const next = new Date(now);
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  // If it's Friday before 22:00, that's the next close
  if (day === 5 && hour < 22) {
    next.setUTCHours(22, 0, 0, 0);
    return next;
  }

  // Otherwise, next close is upcoming Friday 22:00
  const daysUntilFriday = (5 - day + 7) % 7 || 7;
  next.setUTCDate(next.getUTCDate() + daysUntilFriday);
  next.setUTCHours(22, 0, 0, 0);
  return next;
}

/**
 * Format time until next event in human-readable form
 * @param {Date} eventTime - Future time
 * @param {Date} now - Current time
 * @returns {string} e.g., "2h 15m"
 */
function formatTimeUntil(eventTime, now = new Date()) {
  const diffMs = eventTime - now;
  if (diffMs <= 0) return "now";

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

/**
 * Get formatted market status report for display
 * @returns {string}
 */
function getMarketStatusReport() {
  const now = new Date();
  const status = getMarketStatus(now);

  const lines = [];

  if (status.weekend) {
    lines.push("🔴 Markets CLOSED (Weekend)");
    lines.push("");
    lines.push(`Opens: ${status.nextEventTime.toUTCString()}`);
    lines.push(`Time until open: ${formatTimeUntil(status.nextEventTime, now)}`);
  } else if (status.open) {
    lines.push("🟢 Markets OPEN");
    lines.push("");
    lines.push(`Active Sessions: ${status.activeSessions.join(", ")}`);
    lines.push("");
    lines.push(`Closes: ${status.nextEventTime.toUTCString()}`);
    lines.push(`Time until close: ${formatTimeUntil(status.nextEventTime, now)}`);
  } else {
    lines.push("🟡 Markets Between Sessions");
    lines.push("");
    lines.push(`Next Open: ${status.nextEventTime.toUTCString()}`);
    lines.push(`Time until open: ${formatTimeUntil(status.nextEventTime, now)}`);
  }

  return lines.join("\n");
}

module.exports = {
  isMarketOpen,
  isWeekend,
  getMarketStatus,
  getActiveSessions,
  getNextMarketOpen,
  getNextMarketClose,
  formatTimeUntil,
  getMarketStatusReport,
  SESSIONS,
};
