import { describe, expect, it } from 'vitest';
import { Position, Agent, Selection, Building, RoofAlpha, Movement, ChatPartner } from './components';

describe('ECS components', () => {
  it('should define Position component with defaults', () => {
    const pos = Position.create({ x: 10, y: 20 });
    expect(pos.x).toBe(10);
    expect(pos.y).toBe(20);
    expect(pos.z).toBe(0);
  });

  it('should define Agent component', () => {
    const agent = Agent.create({ id: 'a1', name: 'Alice' });
    expect(agent.id).toBe('a1');
    expect(agent.status).toBe('idle');
  });

  it('should define Movement component', () => {
    const mv = Movement.create({ targetX: 100, targetY: 50, moving: true });
    expect(mv.moving).toBe(true);
    expect(mv.targetX).toBe(100);
  });
});