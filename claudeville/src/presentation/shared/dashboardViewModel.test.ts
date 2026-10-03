import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, expect, it } from 'vitest';

import {
  PROVIDER_COLORS,
  PROVIDER_ICONS,
  PROVIDER_LABELS,
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
      { id: 'a2', project: '/repo/app' },
      { id: 'a3', project: '/repo/app' },
    ];

    const groups = groupByProject(agents);

    expect(Array.from(groups.keys())).toEqual(['_unknown', '/repo/app']);
    expect(groups.get('/repo/app')).toHaveLength(2);
  });

  it('formats project labels and paths consistently', () => {
    expect(shortProjectName('/Users/alex/work/app', 'Unknown project')).toBe('app');
    expect(shortProjectName('/Users/alex', 'Unknown project')).toBe('~');
    expect(shortProjectName(undefined, 'Unknown project')).toBe('Unknown project');

    // Edge cases for shortProjectName
    expect(shortProjectName('/repo/app/', 'Unknown project')).toBe('app');
    expect(shortProjectName('/repo/app///', 'Unknown project')).toBe('app');
    expect(shortProjectName('my-project', 'Unknown project')).toBe('my-project');
    expect(shortProjectName('_unknown', 'Unknown project')).toBe('Unknown project');
    expect(shortProjectName(null, 'Unknown project')).toBe('Unknown project');
    expect(shortProjectName('', 'Unknown project')).toBe('Unknown project');
    expect(shortProjectName('/repo//app', 'Unknown project')).toBe('app');
    expect(shortProjectName('/', 'Unknown project')).toBe('/');

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

  // A provider's presentation lives in three places that must agree: the two
  // maps above, and the `.provider-icon--*` / `.provider-badge--*` rules in
  // claudeville/css/react-app.css — the CSS is what actually renders, because
  // Sidebar.tsx and DashboardView.tsx both build the class name from the
  // provider key. Three providers were added after the initial six and were
  // missing from all three, so their badges fell through to the grey
  // `--unknown` rules while getProviderIcon() returned '?'. This test is what
  // stops the next adapter repeating that.
  describe('provider presentation stays in sync across TS maps and CSS', () => {
    const css = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../css/react-app.css'),
      'utf-8',
    );
    const keys = Object.keys(PROVIDER_COLORS);

    it('covers every registered adapter', () => {
      // Keep in step with the registry at claudeville/adapters/index.ts. A new
      // adapter must add its entries here, or this test fails and says so.
      expect(keys.slice().sort()).toEqual([
        'claude', 'codex', 'copilot', 'gemini', 'hermes',
        'openclaw', 'opencode', 'pi', 'vscode',
      ]);
    });

    it.each(keys)('gives %s a label and an icon', (provider) => {
      expect(PROVIDER_LABELS[provider], `label for ${provider}`).toBeTruthy();
      expect(PROVIDER_ICONS[provider], `icon for ${provider}`).toBeTruthy();
    });

    it.each(keys)('defines icon and badge CSS rules for %s', (provider) => {
      expect(css, `.provider-icon--${provider}`).toContain(`.provider-icon--${provider} {`);
      expect(css, `.provider-badge--${provider}`).toContain(`.provider-badge--${provider} {`);
    });

    it.each(keys)('uses the same hex in CSS as in PROVIDER_COLORS for %s', (provider) => {
      const icon = new RegExp(`\\.provider-icon--${provider} \\{ color: (#[0-9a-f]{6});`);
      const badge = new RegExp(`\\.provider-badge--${provider} \\{ color: (#[0-9a-f]{6});`);
      expect(css.match(icon)?.[1], `icon hex for ${provider}`).toBe(PROVIDER_COLORS[provider]);
      expect(css.match(badge)?.[1], `badge hex for ${provider}`).toBe(PROVIDER_COLORS[provider]);
    });

    // The badge background is rgba() of the same hex at 0.15 alpha, matching the
    // six pre-existing entries. A hand-typed rgba drifts from the hex often.
    it.each(keys)('derives the badge background from the %s hex', (provider) => {
      const hex = PROVIDER_COLORS[provider];
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(css, `background for ${provider}`).toContain(
        `.provider-badge--${provider} { color: ${hex}; background: rgba(${r}, ${g}, ${b}, 0.15); }`,
      );
    });
  });
});
