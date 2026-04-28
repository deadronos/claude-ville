import { GradientAvatar } from './GradientAvatar.js';

export function AvatarPreview({ agent }: { agent: any }) {
  return (
    <div className="dash-card__avatar-wrapper" style={{ flexShrink: 0 }}>
      <GradientAvatar id={agent.id} size={40} />
    </div>
  );
}
