/**
 * Shared JSONL file utilities.
 * readLines + parseJsonLines are duplicated verbatim in openclaw, copilot, codex, vscode.
 * Extract once; adapters import from here.
 */
const fs = require('fs');

/**
 * Read the last N (or first N) lines of a file as strings.
 * @param {string} filePath
 * @param {{ from: 'start'|'end', count: number }} options
 * @returns {Promise<string[]>}
 */
async function readLines(filePath, { from = 'end', count = 50 } = {}) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (from === 'start') return lines.slice(0, count);
    return lines.slice(-count);
  } catch {
    return [];
  }
}

/**
 * Parse an array of JSONL strings into objects, skipping bad lines.
 * @param {string[]} lines
 * @returns {object[]}
 */
function parseJsonLines(lines) {
  const results = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { results.push(JSON.parse(line)); } catch { /* ignore */ }
  }
  return results;
}

module.exports = { readLines, parseJsonLines };