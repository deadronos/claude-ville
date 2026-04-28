import { useEffect, useRef } from 'react';

import { AvatarCanvas } from '../../dashboard-mode/AvatarCanvas.js';

export function AvatarPreview({ agent, className = 'dash-card__avatar' }: { agent: any; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) {
      return;
    }

    container.innerHTML = '';
    const probe = document.createElement('canvas');
    if (typeof probe.getContext !== 'function' || !probe.getContext('2d')) {
      return;
    }

    const avatar = new AvatarCanvas(agent);
    container.appendChild(avatar.canvas);

    return () => {
      container.innerHTML = '';
    };
  }, [agent]);

  return <div ref={ref} className={className} />;
}
