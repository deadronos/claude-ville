/**
 * Shared JSONL file utilities.
 * readLines + parseJsonLines are duplicated verbatim in openclaw, copilot, codex, vscode.
 * Extract once; adapters import from here.
 */
const fs = require('fs');

function debugAdapterError(scope, operation, err, context = '') {
  if (!process.env.DEBUG) return;

  const message = err instanceof Error ? err.message : String(err);
  const suffix = context ? ` ${context}` : '';
  console.debug(`[${scope}] ${operation}${suffix}: ${message}`);
}

/**
 * Read the last N (or first N) lines of a file as strings.
 * @param {string} filePath
 * @param {{ from: 'start'|'end', count: number }} options
 * @returns {Promise<string[]>}
 */
async function readLines(filePath, { from = 'end', count = 50, scope = 'jsonl-utils' } = {}) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (from === 'start') return lines.slice(0, count);
    return lines.slice(-count);
  } catch (err) {
    debugAdapterError(scope, `readLines(${from})`, err, filePath);
    return [];
  }
}

/**
 * Parse an array of JSONL strings into objects, skipping bad lines.
 * @param {string[]} lines
 * @returns {object[]}
 */
function parseJsonLines(lines, scope = 'jsonl-utils') {
  const results = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { results.push(JSON.parse(line)); } catch (err) {
      debugAdapterError(scope, 'parseJsonLines', err, line.substring(0, 120));
    }
  }
  return results;
}

module.exports = { debugAdapterError, readLines, parseJsonLines };