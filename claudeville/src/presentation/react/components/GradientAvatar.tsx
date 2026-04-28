import { useMemo } from 'react';

export function GradientAvatar({ id, size = 32 }: { id: string; size?: number }) {
  const { hue1, hue2 } = useMemo(() => {
    const hash = id.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
    const h1 = Math.abs(hash) % 360;
    const h2 = (Math.abs(hash) * 137) % 360;
    return { hue1: h1, hue2: h2 };
  }, [id]);

  return (
    <div
      className="gradient-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `linear-gradient(135deg, hsl(${hue1}, 80%, 65%), hsl(${hue2}, 80%, 45%))`,
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)'
      }}
    />
  );
}
