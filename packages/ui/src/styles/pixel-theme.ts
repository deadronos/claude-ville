export const pixelTheme = {
  colors: {
    background: '#0f0f23',
    surface: '#1a1a2e',
    surfaceAlt: '#16213e',
    border: '#4a4a6a',
    text: '#e0e0e0',
    accent: '#00d9ff',
    accentAlt: '#7b2cbf',
    success: '#00ff88',
    warning: '#ffaa00',
    danger: '#ff4757',
    working: '#00ff88',
    idle: '#00d9ff',
    waiting: '#ffaa00',
  },
  fontFamily: {
    pixel: '"Press Start 2P", monospace',
  },
  fontSize: {
    xs: '8px',
    sm: '10px',
    base: '12px',
    lg: '14px',
  },
  spacing: {
    unit: '8px',
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
} as const;

export type PixelTheme = typeof pixelTheme;
