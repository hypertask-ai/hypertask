"use strict";

function measuredUsage(usage, fallback) {
  if (usage && (usage.source === "provider" || usage.source === "transcript")) {
    return {
      tokensIn: Number.isFinite(usage.tokensIn) ? usage.tokensIn : null,
      tokensOut: Number.isFinite(usage.tokensOut) ? usage.tokensOut : null,
      source: usage.source,
    };
  }
  return {
    tokensIn: null,
    tokensOut: null,
    source: usage?.source || fallback || "unavailable",
  };
}

module.exports = {
  measuredUsage,
};
