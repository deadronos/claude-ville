/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';

// Set up window config before importing Agent (which imports agentNames at load time)
beforeEach(() => {
  (window as any).__CLAUDEVILLE_CONFIG__ = {};
  localStorage.clear();
});

import { Agent } from './Agent.js';

const makeProps = (overrides: Record<string, any> = {}) => ({
  id: 'agent-1',
  name: 'TestAgent',
  model: 'claude-sonnet-4-5',
  status: 'working',
  role: 'coder',
  tokens: { input: 1000, output: 500 },
  messages: [],
  teamName: null,
  projectPath: '/test/project',
  provider: 'claude',
  lastTool: null,
  lastToolInput: null,
  _lastMessage: null, // maps to constructor param: lastMessage
  ...overrides,
});

describe('Agent', () => {
  describe('constructor', () => {
    it('stores id and model', () => {
      const agent = new Agent(makeProps({ id: 'a1', model: 'claude-opus-4-6' }));
      expect(agent.id).toBe('a1');
      expect(agent.model).toBe('claude-opus-4-6');
    });

    it('defaults model to unknown', () => {
      const agent = new Agent(makeProps({ model: undefined as any }));
      expect(agent.model).toBe('unknown');
    });

    it('defaults status to IDLE', () => {
      const agent = new Agent(makeProps({ status: undefined as any }));
      expect(agent.status).toBe('idle');
    });

    it('defaults role to general', () => {
      const agent = new Agent(makeProps({ role: undefined as any }));
      expect(agent.role).toBe('general');
    });

    it('defaults tokens to zero', () => {
      const agent = new Agent(makeProps({ tokens: undefined as any }));
      expect(agent.tokens).toEqual({ input: 0, output: 0 });
    });

    it('defaults provider to claude', () => {
      const agent = new Agent(makeProps({ provider: undefined as any }));
      expect(agent.provider).toBe('claude');
    });

    it('sets nameSeed from id when nameSeed not provided', () => {
      const agent = new Agent(makeProps({ nameSeed: undefined as any }));
      expect(agent.nameSeed).toBe('agent-1');
    });

    it('uses provided nameSeed over id', () => {
      const agent = new Agent(makeProps({ nameSeed: 'custom-seed' }));
      expect(agent.nameSeed).toBe('custom-seed');
    });

    it('uses provided name when given', () => {
      const agent = new Agent(makeProps({ name: 'Alice' }));
      expect(agent.name).toBe('Alice');
    });

    it('defaults messages to empty array', () => {
      const agent = new Agent(makeProps({ messages: undefined as any }));
      expect(agent.messages).toEqual([]);
    });

    it('defaults lastTool/currentToolInput/lastMessage to null', () => {
      const agent = new Agent(makeProps({
        lastTool: undefined as any,
        lastToolInput: undefined as any,
        lastMessage: undefined as any,
      }));
      expect(agent.currentTool).toBeNull();
      expect(agent.currentToolInput).toBeNull();
      expect(agent._lastMessage).toBeNull();
    });

    it('creates an Appearance from hash of id', () => {
      const agent = new Agent(makeProps());
      expect(agent.appearance).toBeDefined();
      expect(agent.appearance.skin).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('creates a Position (with random values)', () => {
      const agent = new Agent(makeProps());
      expect(agent.position.tileX).toBeGreaterThanOrEqual(20);
      expect(agent.position.tileY).toBeGreaterThanOrEqual(20);
      expect(agent.targetPosition).toBeNull();
    });

    it('sets walkFrame to 0', () => {
      const agent = new Agent(makeProps());
      expect(agent.walkFrame).toBe(0);
    });

    it('records lastActive to now', () => {
      const before = Date.now();
      const agent = new Agent(makeProps());
      expect(agent.lastActive).toBeGreaterThanOrEqual(before);
    });
  });

  describe('isWorking', () => {
    it('returns true when status is working', () => {
      const agent = new Agent(makeProps({ status: 'working' }));
      expect(agent.isWorking).toBe(true);
    });

    it('returns false when status is idle', () => {
      const agent = new Agent(makeProps({ status: 'idle' }));
      expect(agent.isWorking).toBe(false);
    });

    it('returns false when status is waiting', () => {
      const agent = new Agent(makeProps({ status: 'waiting' }));
      expect(agent.isWorking).toBe(false);
    });
  });

  describe('isIdle', () => {
    it('returns true when status is idle', () => {
      const agent = new Agent(makeProps({ status: 'idle' }));
      expect(agent.isIdle).toBe(true);
    });

    it('returns false when status is working', () => {
      const agent = new Agent(makeProps({ status: 'working' }));
      expect(agent.isIdle).toBe(false);
    });
  });

  describe('cost getter', () => {
    it('calculates cost from tokens and model', () => {
      // 1000 input + 500 output at sonnet rates = (1000*3 + 500*15) / 1M = 0.0105
      const agent = new Agent(makeProps({ model: 'claude-sonnet-4-5', tokens: { input: 1000, output: 500 } }));
      expect(agent.cost).toBeCloseTo(0.0105, 4);
    });

    it('returns 0 for zero tokens', () => {
      const agent = new Agent(makeProps({ tokens: { input: 0, output: 0 } }));
      expect(agent.cost).toBe(0);
    });

    it('uses unknown model rate (falls back to Sonnet)', () => {
      const agent = new Agent(makeProps({ model: 'unknown-model', tokens: { input: 1_000_000, output: 0 } }));
      expect(agent.cost).toBe(3); // Sonnet input rate
    });
  });

  describe('lastMessage getter', () => {
    it('returns lastMessage when set', () => {
      // Constructor takes lastMessage param → stored as this._lastMessage
      const agent = new Agent({ ...makeProps(), lastMessage: 'hello' });
      expect(agent.lastMessage).toBe('hello');
    });

    it('returns last message from messages array', () => {
      const agent = new Agent({ ...makeProps(), messages: ['a', 'b', 'c'] });
      expect(agent.lastMessage).toBe('c');
    });

    it('returns text from structured message objects', () => {
      const agent = new Agent({ ...makeProps(), messages: [{ role: 'assistant', text: 'structured hello' }] });
      expect(agent.lastMessage).toBe('structured hello');
    });

    it('prefers lastMessage over messages array', () => {
      const agent = new Agent({ ...makeProps(), lastMessage: 'direct', messages: ['a'] });
      expect(agent.lastMessage).toBe('direct');
    });

    it('returns null when neither is set', () => {
      const agent = new Agent({ ...makeProps(), lastMessage: null, messages: [] });
      expect(agent.lastMessage).toBeNull();
    });
  });

  describe('_buildDisplaySession', () => {
    it('builds correct display session for agent kind', () => {
      const agent = new Agent(makeProps({ nameKind: 'agent', nameSeed: 'seed-1', nameHint: 'Bob', provider: 'claude' }));
      const session = agent._buildDisplaySession();
      expect(session.sessionId).toBe('agent-1');
      expect(session.agentId).toBe('seed-1');
      expect(session.displayName).toBe('Bob');
      expect(session.agentType).toBe('sub-agent');
    });

    it('builds correct display session for session kind', () => {
      const agent = new Agent(makeProps({ nameKind: 'session', nameSeed: 's1', nameHint: null, provider: 'claude' }));
      const session = agent._buildDisplaySession();
      expect(session.sessionId).toBe('agent-1');
      expect(session.agentId).toBeNull();
      expect(session.agentType).toBe('main');
    });
  });

  describe('targetBuildingType', () => {
    it('returns chathall for Read tool', () => {
      const agent = new Agent(makeProps({ lastTool: 'Read' }));
      expect(agent.targetBuildingType).toBe('chathall');
    });

    it('returns forge for Edit tool', () => {
      const agent = new Agent(makeProps({ lastTool: 'Edit' }));
      expect(agent.targetBuildingType).toBe('forge');
    });

    it('returns mine for Bash tool', () => {
      const agent = new Agent(makeProps({ lastTool: 'Bash' }));
      expect(agent.targetBuildingType).toBe('mine');
    });

    it('returns taskboard for TaskCreate', () => {
      const agent = new Agent(makeProps({ lastTool: 'TaskCreate' }));
      expect(agent.targetBuildingType).toBe('taskboard');
    });

    it('returns command for Task', () => {
      const agent = new Agent(makeProps({ lastTool: 'Task' }));
      expect(agent.targetBuildingType).toBe('command');
    });

    it('returns null when no currentTool', () => {
      const agent = new Agent(makeProps({ lastTool: null }));
      expect(agent.targetBuildingType).toBeNull();
    });

    it('returns null for unknown tool', () => {
      const agent = new Agent(makeProps({ lastTool: 'UnknownTool' }));
      expect(agent.targetBuildingType).toBeNull();
    });
  });

  describe('bubbleText', () => {
    it('returns truncated tool label with detail when currentTool is set', () => {
      const agent = new Agent(makeProps({ lastTool: 'Read', lastToolInput: '/path/to/file.ts' }));
      const text = agent.bubbleText;
      expect(text).toContain('Reading');
      expect(text).toContain('/path/to/file.ts');
    });

    it('extracts command text from truncated JSON tool input', () => {
      const agent = new Agent(makeProps({
        lastTool: 'run_in_terminal',
        lastToolInput: '{"command":"setopt errexit pipefail && npm run test","goal":"Run tests',
      }));

      expect(agent.bubbleText).toContain('Running');
      expect(agent.bubbleText).toContain('setopt errexit pipefail');
    });

    it('truncates bubbleText to 40 chars', () => {
      const agent = new Agent(makeProps({ lastTool: 'Bash', lastToolInput: 'a very long command that exceeds forty characters here' }));
      expect(agent.bubbleText!.length).toBeLessThanOrEqual(40);
    });

    it('returns truncated lastMessage when no currentTool', () => {
      const agent = new Agent({ ...makeProps(), lastTool: null, lastMessage: 'hello from the agent' });
      expect(agent.bubbleText).toBe('hello from the agent');
    });

    it('falls back to structured messages when direct lastMessage is missing', () => {
      const agent = new Agent({
        ...makeProps(),
        lastTool: null,
        lastMessage: null,
        messages: [{ role: 'assistant', text: 'recent tool result summary' }],
      });

      expect(agent.bubbleText).toBe('recent tool result summary');
    });

    it('returns null when no tool and no lastMessage', () => {
      const agent = new Agent(makeProps({ lastTool: null, _lastMessage: null }));
      expect(agent.bubbleText).toBeNull();
    });

    it('uses raw tool name when no label mapping', () => {
      const agent = new Agent(makeProps({ lastTool: 'CustomTool' }));
      expect(agent.bubbleText).toBe('CustomTool');
    });
  });

  describe('generateName', () => {
    it('returns a string name', () => {
      const agent = new Agent(makeProps({ name: undefined as any }));
      expect(typeof agent.name).toBe('string');
      expect(agent.name.length).toBeGreaterThan(0);
    });
  });

  describe('static generateNameForSeed', () => {
    it('returns a pooled name for a seed', () => {
      const name = Agent.generateNameForSeed('my-seed');
      expect(typeof name).toBe('string');
    });
  });

  describe('regenerateName', () => {
    it('updates name and name metadata from resolved display name', () => {
      const agent = new Agent(makeProps({ name: 'Alice', nameKind: 'session', nameMode: 'autodetected', nameHint: null }));
      agent.regenerateName();
      expect(typeof agent.name).toBe('string');
      expect(typeof agent.nameSeed).toBe('string');
      expect(typeof agent.nameKind).toBe('string');
      expect(typeof agent.nameMode).toBe('string');
    });

    it('returns the new name', () => {
      const agent = new Agent(makeProps({ name: 'OldName' }));
      const newName = agent.regenerateName();
      expect(newName).toBe(agent.name);
    });
  });

  describe('update()', () => {
    it('assigns provided data to agent properties', () => {
      const agent = new Agent(makeProps({ name: 'Alice' }));
      agent.update({ name: 'Bob', status: 'waiting', currentTool: 'Bash' });
      expect(agent.name).toBe('Bob');
      expect(agent.status).toBe('waiting');
      expect(agent.currentTool).toBe('Bash');
    });

    it('updates lastActive to now', () => {
      const agent = new Agent(makeProps());
      const before = Date.now();
      agent.update({ name: 'New' });
      expect(agent.lastActive).toBeGreaterThanOrEqual(before);
    });

    it('handles partial update without overwriting undefined', () => {
      const agent = new Agent(makeProps({ name: 'Alice', status: 'working' }));
      agent.update({ status: 'idle' });
      expect(agent.name).toBe('Alice');
      expect(agent.status).toBe('idle');
    });
  });
});
