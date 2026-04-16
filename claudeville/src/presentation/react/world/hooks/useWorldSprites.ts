import type { MutableRefObject } from 'react';

import { AgentSprite } from '../../../character-mode/AgentSprite.js';

export function useWorldSprites(agents: any[], spritesRef: MutableRefObject<Map<string, AgentSprite>>) {
  const sprites = agents.map((agent) => {
    let sprite = spritesRef.current.get(agent.id);
    if (!sprite) {
      sprite = new AgentSprite(agent);
      spritesRef.current.set(agent.id, sprite);
    }
    sprite.agent = agent;
    return sprite;
  });

  for (const id of Array.from(spritesRef.current.keys())) {
    if (!agents.some((agent) => agent.id === id)) {
      spritesRef.current.delete(id);
    }
  }

  return sprites;
}
