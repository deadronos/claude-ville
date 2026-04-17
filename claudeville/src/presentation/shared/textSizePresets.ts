export type TextSizePresetKey = 'small' | 'medium' | 'large' | 'xlarge';

export type TextSizePreset = {
  key: TextSizePresetKey;
  labelKey: string;
  textScale: number;
  statusFontSize: number;
  maxWidth: number;
  bubbleH: number;
  paddingH: number;
};

export const TEXT_SIZE_PRESETS: TextSizePreset[] = [
  { key: 'small', labelKey: 'bubbleSmall', textScale: 0.8, statusFontSize: 10, maxWidth: 160, bubbleH: 22, paddingH: 18 },
  { key: 'medium', labelKey: 'bubbleMedium', textScale: 1.0, statusFontSize: 14, maxWidth: 260, bubbleH: 28, paddingH: 24 },
  { key: 'large', labelKey: 'bubbleLarge', textScale: 1.25, statusFontSize: 20, maxWidth: 360, bubbleH: 38, paddingH: 32 },
  { key: 'xlarge', labelKey: 'bubbleExtraLarge', textScale: 1.5, statusFontSize: 28, maxWidth: 480, bubbleH: 52, paddingH: 44 },
];

export function getTextSizePresetKey(textScale: number): TextSizePresetKey {
  return TEXT_SIZE_PRESETS.find((preset) => preset.textScale === textScale)?.key
    || (textScale < 0.9 ? 'small' : textScale < 1.1 ? 'medium' : textScale < 1.4 ? 'large' : 'xlarge');
}
