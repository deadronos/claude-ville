/**
 * 어댑터 공통 텍스트 정리 유틸
 * - UI에 노이즈성 문자열이 그대로 노출되는 것을 완화
 * - provider별 파서가 raw 데이터를 유지하더라도 공통 레이어에서 표시용으로 정리
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

  const patterns = [
    /^file_count\s+\d+\s+ageSec=\s*\d+(?:\s+size=.*)?\s*$/i,
    /^providers?=\s*\[[^\]]*\]\s*$/i,
    /^vscodeCount=\s*\d+\s*$/i,
    /^toolHistoryCount=\s*\d+\s*$/i,
    /^messagesCount=\s*\d+\s*$/i,
    /^recentFiles:\s*$/i,
    /^ageSec=\s*\d+\s+mtime=/i,
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
