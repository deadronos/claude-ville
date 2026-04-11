/**
 * Shared text sanitization utilities for adapters
 * - Prevents noisy machine-generated strings from appearing in the UI
 * - Provider parsers keep raw data; this layer cleans it for display
 */

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeText(value, maxLen = 200) {
  return normalizeWhitespace(value).substring(0, maxLen);
}

function looksLikeNoise(text) {
  if (!text) return true;

  // Match only complete status-line patterns that never appear in real user messages.
  // Each pattern must anchor at start (^) and end ($) — partial matches within
  // user text should not be flagged.
  const patterns = [
    /^file_count\s+\d+\s+ageSec=\s*\d+(?:\s+size=.*)?$/,
    /^providers?=\s*\[[^\]]*\]$/,
    /^vscodeCount=\s*\d+$/,
    /^toolHistoryCount=\s*\d+$/,
    /^messagesCount=\s*\d+$/,
    /^recentFiles:$/,
    /^ageSec=\s*\d+\s+mtime=/,
  ];

  return patterns.some((re) => re.test(text));
}

function cleanText(value, maxLen = 200) {
  const text = summarizeText(value, maxLen);
  if (!text || looksLikeNoise(text)) return '';
  return text;
}

function sanitizeToolHistory(toolHistory = []) {
  if (!Array.isArray(toolHistory)) return [];

  return toolHistory
    .map((item) => ({
      ...item,
      tool: summarizeText(item?.tool || '', 80) || (item?.tool || 'unknown'),
      detail: cleanText(item?.detail || '', 140),
    }))
    .filter((item) => item.tool || item.detail);
}

function sanitizeMessages(messages = []) {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((msg) => ({
      ...msg,
      text: cleanText(msg?.text || '', 220),
    }))
    .filter((msg) => msg.text);
}

function sanitizeSessionDetail(detail = {}) {
  return {
    ...detail,
    toolHistory: sanitizeToolHistory(detail?.toolHistory || []),
    messages: sanitizeMessages(detail?.messages || []),
  };
}

function sanitizeSessionSummary(session = {}) {
  return {
    ...session,
    rawLastMessage: session?.lastMessage ?? null,
    rawLastToolInput: session?.lastToolInput ?? null,
    lastMessage: summarizeText(session?.lastMessage || '', 120) || null,
    lastToolInput: summarizeText(session?.lastToolInput || '', 80) || null,
  };
}

module.exports = {
  cleanText,
  sanitizeSessionDetail,
  sanitizeSessionSummary,
  summarizeText,
};
