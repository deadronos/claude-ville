import { useRef } from 'react';

import { PROJECT_COLORS } from '../../shared/dashboardViewModel.js';

export function useStableProjectColors(keys: string[]) {
  const colorMapRef = useRef(new Map<string, number>());

  for (const key of keys) {
    if (!colorMapRef.current.has(key)) {
      colorMapRef.current.set(key, colorMapRef.current.size % PROJECT_COLORS.length);
    }
  }

  return colorMapRef.current;
}
