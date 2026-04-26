import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const originalHermesDir = process.env.HERMES_DIR;

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeJsonl(filePath: string, values: unknown[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`);
}

async function loadAdapter(hermesDir: string) {
  process.env.HERMES_DIR = hermesDir;
  vi.resetModules();
  const mod = await import('./hermes.js');
  return new mod.HermesAdapter();
}

describe('hermes adapter', () => {
  afterEach(() => {
    if (originalHermesDir === undefined) {
      delete process.env.HERMES_DIR;
    } else {
      process.env.HERMES_DIR = originalHermesDir;
    }
    vi.resetModules();
  });

  it('reads active sessions from Hermes metadata and JSONL transcripts', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-adapter-'));
    const now = Date.now();
    const sessionId = '20260426_154631_8edf9b47';
    const sessionFile = path.join(tmp, 'sessions', `session_${sessionId}.json`);
    const transcriptFile = path.join(tmp, 'sessions', `${sessionId}.jsonl`);

    writeJson(sessionFile, {
      session_id: sessionId,
      model: 'MiniMax-M2.7',
      provider: 'minimax',
      platform: 'telegram',
      display_name: 'Lars',
      session_start: '2026-04-26T15:46:31.886519',
      last_updated: new Date(now - 1000).toISOString(),
    });
    writeJsonl(transcriptFile, [
      { role: 'user', content: 'Please update docs', timestamp: '2026-04-26T15:46:35.000Z' },
      { role: 'assistant', content: 'I will inspect the files.', timestamp: '2026-04-26T15:47:00.000Z' },
      { role: 'tool', name: 'read_file', content: '{"path":"/tmp/demo.md"}', timestamp: '2026-04-26T15:48:00.000Z' },
    ]);
    fs.utimesSync(sessionFile, new Date(now - 1000), new Date(now - 1000));
    fs.utimesSync(transcriptFile, new Date(now - 500), new Date(now - 500));

    const adapter = await loadAdapter(tmp);
    const sessions = await adapter.getActiveSessions(60_000);

    fs.rmSync(tmp, { recursive: true, force: true });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: `hermes-${sessionId}`,
      provider: 'hermes',
      model: 'minimax/MiniMax-M2.7',
      project: 'telegram:Lars',
      lastTool: 'read_file',
      lastToolInput: '{"path":"/tmp/demo.md"}',
      lastMessage: 'I will inspect the files.',
      filePath: transcriptFile,
    });
  });

  it('returns detail from a Hermes transcript file path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-adapter-'));
    const transcriptFile = path.join(tmp, 'sessions', '20260426_154631_8edf9b47.jsonl');
    writeJsonl(transcriptFile, [
      { role: 'user', content: 'Hello', timestamp: '2026-04-26T15:46:35.000Z' },
      { role: 'assistant', content: 'Hi there', timestamp: '2026-04-26T15:47:00.000Z' },
      { role: 'tool', name: 'patch', content: '{"mode":"replace"}', timestamp: '2026-04-26T15:48:00.000Z' },
    ]);

    const adapter = await loadAdapter(tmp);
    const detail = await adapter.getSessionDetail('hermes-20260426_154631_8edf9b47', null, transcriptFile);

    fs.rmSync(tmp, { recursive: true, force: true });
    expect(detail.toolHistory).toEqual([{ tool: 'patch', detail: '{"mode":"replace"}', ts: Date.parse('2026-04-26T15:48:00.000Z') }]);
    expect(detail.messages).toEqual([
      { role: 'user', text: 'Hello', ts: Date.parse('2026-04-26T15:46:35.000Z') },
      { role: 'assistant', text: 'Hi there', ts: Date.parse('2026-04-26T15:47:00.000Z') },
    ]);
  });
});
