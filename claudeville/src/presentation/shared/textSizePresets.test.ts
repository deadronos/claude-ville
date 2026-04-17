import { describe, expect, it } from 'vitest';

import { TEXT_SIZE_PRESETS, getTextSizePresetKey } from './textSizePresets.js';

describe('textSizePresets', () => {
  it('exposes the expected preset keys', () => {
    expect(TEXT_SIZE_PRESETS.map((preset) => preset.key)).toEqual(['small', 'medium', 'large', 'xlarge']);
  });

  it('maps text scale values to preset keys', () => {
    expect(getTextSizePresetKey(0.8)).toBe('small');
    expect(getTextSizePresetKey(1)).toBe('medium');
    expect(getTextSizePresetKey(1.25)).toBe('large');
    expect(getTextSizePresetKey(1.5)).toBe('xlarge');
  });
});
