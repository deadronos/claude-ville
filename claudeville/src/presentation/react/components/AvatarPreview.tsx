import { useEffect, useRef } from 'react';

import { AvatarCanvas } from '../../dashboard-mode/AvatarCanvas.js';

export function AvatarPreview({ agent }: { agent: any }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }

    container.innerHTML = '';
    const avatar = new AvatarCanvas(agent);
    container.appendChild(avatar.canvas);

    return () => {
      container.innerHTML = '';
    };
  }, [agent]);

  return <div ref={ref} className="dash-card__avatar" />;
}
