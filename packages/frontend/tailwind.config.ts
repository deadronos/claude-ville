import type { Config } from 'tailwindcss';
import { pixelTheme } from '@claude-ville/ui/src/styles/pixel-theme';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: pixelTheme.colors,
      fontFamily: pixelTheme.fontFamily,
      fontSize: pixelTheme.fontSize,
      spacing: pixelTheme.spacing,
    },
  },
  plugins: [],
} satisfies Config;
