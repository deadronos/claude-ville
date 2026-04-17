import { describe, expect, it } from 'vitest';

import {
  getProviderIcon,
  getProviderLabel,
  getToolCategory,
  getToolIcon,
  groupByProject,
  formatCost,
  formatNumber,
  shortModel,
  shortProjectName,
  shortToolName,
  truncateProjectPath,
} from './dashboardViewModel.js';

describe('dashboardViewModel', () => {
  it('groups agents by project and preserves insertion order', () => {
    const agents = [
      { id: 'a1' },
      { id: 'a2', projectPath: '/repo/app' },
      { id: 'a3', projectPath: '/repo/app' },
    ];

    const groups = groupByProject(agents);

    expect(Array.from(groups.keys())).toEqual(['_unknown', '/repo/app']);
    expect(groups.get('/repo/app')).toHaveLength(2);
  });

  it('formats project labels and paths consistently', () => {
    expect(shortProjectName('/Users/alex/work/app', 'Unknown project')).toBe('app');
    expect(shortProjectName('/Users/alex', 'Unknown project')).toBe('~');
    expect(shortProjectName(undefined, 'Unknown project')).toBe('Unknown project');
    expect(truncateProjectPath('/Users/alex/work/app')).toBe('~/work/app');
  });

  it('shortens models, tools, and provider labels', () => {
    expect(shortModel('claude-sonnet-4-5')).toBe('sonnet-4-5');
    expect(shortModel('claude-opus-4-6-20250101')).toBe('opus-4-6');
    expect(getToolIcon('Read')).toBe('📖');
    expect(getToolIcon('mcp__playwright__open')).toBe('🎭');
    expect(getToolCategory('mcp__anything__tool')).toBe('exec');
    expect(shortToolName('mcp__playwright__click')).toBe('pw:click');
    expect(getProviderLabel('claude')).toBe('Claude');
    expect(getProviderIcon('copilot')).toBe('P');
  });

  it('formats numbers and costs', () => {
    expect(formatNumber(12345)).toBe('12,345');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(Number.NaN)).toBe('$0.00');
  });
});
