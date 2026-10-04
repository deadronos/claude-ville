/**
 * The format-specific readers for the Gemini CLI adapter, split out of
 * `gemini.ts` for file size. `gemini.ts` stays the entry point and owns the
 * adapter class and the scan; the dependency is one-way.
 */
import fs from 'fs';

import { readLines, parseJsonLines, foldEntries } from './jsonl-utils.js';
import { extractText } from './text-utils.js';

// ─── Session parsing ────────────────────────────────────────

async function readJsonFile(filePath: string) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load a session's records from EITHER of the two shapes gemini writes.
 *
 * A `.jsonl` session is a stream of records, one per line, so only the last
 * `count` of them are read. A `.json` session is ONE document whose `messages`
 * array holds the same records; it is parsed whole, so `count` does not apply to
 * it and that reader sees every record the session has. This asymmetry is real and
 * observable — a `.jsonl` session whose last 20 lines are all tool calls reports
 * no conversation at all, while the `.json` twin of it reports five messages.
 *
 * This is the ONE place that knows about the split, and it is why the fold that
 * consumes these records is `foldEntries` over the returned array and NOT
 * `foldJsonl`: `foldJsonl` reads lines, so in a `.json` document every chunk
 * fails `JSON.parse` and the fold sees nothing. `collectJsonl` is unusable here
 * for the same reason.
 *
 * `count` stays per call site because the four readers genuinely disagree —
 * 50 / 100 / 20 / 2000 — and each of those numbers is pinned by
 * gemini.fixture.test.ts. Do not hoist it to a default.
 */
async function loadSessionMessages(filePath: string, count: number): Promise<any[]> {
  if (filePath.endsWith('.jsonl')) {
    const lines = await readLines(filePath, { count, scope: 'gemini-adapter' });
    return parseJsonLines(lines, 'gemini-adapter');
  }
  const session = await readJsonFile(filePath);
  return session && Array.isArray(session.messages) ? session.messages : [];
}

/**
 * Extract model/tools/messages from Gemini session JSON
 * Actual format: {sessionId, projectHash, messages: [{type, content, model, ...}]}
 */
async function parseSession(filePath: string) {
  const detail: {
    model: string | null;
    lastTool: string | null;
    lastToolInput: string | null;
    lastMessage: string | null;
  } = {
    model: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  try {
    const messages = await loadSessionMessages(filePath, 50);

    if (messages.length === 0) return detail;

    // Iterate in reverse from the end
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      // Gemini response message
      if (msg.type === 'gemini') {
        // Model info
        if (!detail.model && msg.model) {
          detail.model = msg.model;
        }

        // Text message
        if (!detail.lastMessage && msg.content) {
          const text = extractText(msg.content);
          if (text.length > 0) {
            detail.lastMessage = text.substring(0, 80);
          }
        }

        // Tool usage (when toolCalls exists)
        if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) {
          for (const tc of msg.toolCalls) {
            detail.lastTool = tc.name || 'function_call';
            if (tc.args) {
              const args = tc.args;
              if (args.command) detail.lastToolInput = args.command.substring(0, 60);
              else if (args.file_path) detail.lastToolInput = args.file_path.split('/').pop();
              else detail.lastToolInput = JSON.stringify(args).substring(0, 60);
            }
            break;
          }
        }
      }

      // Tool call result (tool_call type)
      if (!detail.lastTool && msg.type === 'tool_call') {
        detail.lastTool = msg.name || msg.toolName || 'tool';
        if (msg.input) {
          detail.lastToolInput = (typeof msg.input === 'string'
            ? msg.input : JSON.stringify(msg.input)
          ).substring(0, 60);
        }
      }

      if (detail.lastMessage && detail.model) break;
    }
  } catch { /* ignore */ }

  return detail;
}

/**
 * Extract tool history from Gemini session
 */
async function getToolHistory(filePath: string, maxItems = 15) {
  type ToolEntry = { tool: string; detail: string; ts: number };
  const tools: ToolEntry[] = [];
  try {
    const messages = await loadSessionMessages(filePath, 100);

    for (const msg of messages) {
      // Check toolCalls in gemini type
      if (msg.type === 'gemini' && msg.toolCalls && Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          let detail = '';
          if (tc.args) {
            if (tc.args.command) detail = tc.args.command.substring(0, 80);
            else if (tc.args.file_path) detail = tc.args.file_path;
            else detail = JSON.stringify(tc.args).substring(0, 80);
          }
          tools.push({
            tool: tc.name || 'function_call',
            detail,
            ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
          });
        }
      }

      // tool_call type
      if (msg.type === 'tool_call') {
        let detail = '';
        if (msg.input) {
          detail = (typeof msg.input === 'string'
            ? msg.input : JSON.stringify(msg.input)
          ).substring(0, 80);
        }
        tools.push({
          tool: msg.name || msg.toolName || 'tool',
          detail,
          ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
        });
      }
    }
  } catch { /* ignore */ }
  return tools.slice(-maxItems);
}

/**
 * Extract recent messages from Gemini session
 */
async function getRecentMessages(filePath: string, maxItems = 5) {
  type MsgEntry = { role: string; text: string; ts: number };
  const msgList: MsgEntry[] = [];
  try {
    const messages = await loadSessionMessages(filePath, 20);

    for (const msg of messages) {
      if (msg.type === 'info') continue; // Skip info messages

      const text = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (text.length === 0) continue;

      msgList.push({
        role: msg.type === 'gemini' ? 'assistant' : msg.type === 'user' ? 'user' : 'system',
        text: text.substring(0, 200),
        ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
      });
    }
  } catch { /* ignore */ }
  return msgList.slice(-maxItems);
}

/** The accumulator `getTokenUsage` folds over. `found` is what makes the
 *  no-reading answer `null` rather than `{ input: 0, output: 0 }`. */
type TokenFold = { input: number; output: number; found: boolean };

/**
 * Sum per-response `tokens` records into session totals.
 *
 * `foldEntries` over the ALREADY-LOADED records, not `foldJsonl` over the file:
 * a `.json` session is one parsed document, and `foldJsonl` would find no lines
 * in it. `onEntry` is `=> void` and the return value is discarded, so `acc` is
 * mutated in place — `(acc, e) => ({ ...acc, input: e.x })` would typecheck and
 * sum nothing at all.
 *
 * The two `typeof` guards are independent, as they have always been: a record
 * whose `input` is a string still contributes its numeric `output`. gemini
 * guards where codex coerces, and that difference is deliberate.
 */
async function getTokenUsage(filePath: string) {
  try {
    const fold = foldEntries<TokenFold>(await loadSessionMessages(filePath, 2000), {
      init: { input: 0, output: 0, found: false },
      onEntry: (acc, msg) => {
        const tokens = msg?.tokens;
        if (!tokens) return;
        if (typeof tokens.input === 'number') {
          acc.input += tokens.input;
          acc.found = true;
        }
        if (typeof tokens.output === 'number') {
          acc.output += tokens.output;
          acc.found = true;
        }
      },
    });
    return fold.found ? { input: fold.input, output: fold.output } : null;
  } catch {
    return null;
  }
}
export { parseSession, getToolHistory, getRecentMessages, getTokenUsage };
