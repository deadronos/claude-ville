const assert = require('assert/strict');
const test = require('node:test');

const {
  cleanText,
  sanitizeSessionDetail,
  sanitizeSessionSummary,
} = require('./sanitize');

test('cleanText collapses whitespace and trims', () => {
  assert.equal(cleanText('  hello\n\nworld   '), 'hello world');
});

test('cleanText filters noisy diagnostics lines', () => {
  assert.equal(cleanText('file_count 279 ageSec=0 size=...'), '');
  assert.equal(cleanText('vscodeCount= 1'), '');
  assert.equal(cleanText('providers= [\'claude\',\'vscode\']'), '');
});

test('sanitizeSessionSummary cleans last message and tool input', () => {
  const session = sanitizeSessionSummary({
    lastMessage: '  useful update from model  ',
    lastToolInput: '   /Users/me/project/file.js   ',
  });

  assert.equal(session.lastMessage, 'useful update from model');
  assert.equal(session.lastToolInput, '/Users/me/project/file.js');
});

test('sanitizeSessionDetail drops noisy messages and keeps valid ones', () => {
  const detail = sanitizeSessionDetail({
    toolHistory: [
      { tool: 'read_file', detail: '  {"filePath":"/tmp/a"}  ', ts: 1 },
      { tool: 'call_result', detail: 'file_count 279 ageSec=0', ts: 2 },
    ],
    messages: [
      { role: 'assistant', text: 'file_count 279 ageSec=0', ts: 10 },
      { role: 'assistant', text: ' Real assistant message ', ts: 11 },
    ],
  });

  assert.equal(detail.toolHistory.length, 2);
  assert.equal(detail.toolHistory[0].detail, '{"filePath":"/tmp/a"}');
  assert.equal(detail.toolHistory[1].detail, '');
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.messages[0].text, 'Real assistant message');
});
