import { describe, it, expect } from 'vitest';
import { createWorld } from './world.js';

describe('ECSWorld', () => {
  it('creates entities and wraps them in Proxy', () => {
    const world = createWorld();
    const entity = world.createEntity();

    expect(entity).toBeDefined();
    entity.Agent = true;
    entity.moving = true;

    const query = world.with('Agent', 'moving');
    expect(query.entities).toContain(entity);
  });

  it('updates indexes reactively when properties are modified', () => {
    const world = createWorld();
    const entity = world.createEntity();

    entity.moving = true;
    expect(world.with('moving').entities).toContain(entity);

    // Remove component
    entity.moving = null;
    expect(world.with('moving').entities).not.toContain(entity);

    // Re-add component
    entity.moving = false; // False is still a value, should match
    expect(world.with('moving').entities).toContain(entity);

    // Delete property
    delete entity.moving;
    expect(world.with('moving').entities).not.toContain(entity);
  });

  it('performs set intersections correctly for multiple query components', () => {
    const world = createWorld();
    const e1 = world.createEntity();
    const e2 = world.createEntity();

    e1.Agent = true;
    e1.moving = true;

    e2.Agent = true;
    e2.moving = false;

    // Both have Agent and moving (since false is a valid non-null component value)
    expect(world.with('Agent', 'moving').entities).toContain(e1);
    expect(world.with('Agent', 'moving').entities).toContain(e2);

    e2.moving = null; // Remove moving from e2
    const query = world.with('Agent', 'moving');
    expect(query.entities).toContain(e1);
    expect(query.entities).not.toContain(e2);
  });

  it('correctly handles manual entity addition and existing property indexing', () => {
    const world = createWorld();
    const rawEntity = { Agent: true, id: 'a-1' };

    world.addEntity(rawEntity);

    // Queries should find it
    const query = world.with('Agent');
    expect(query.entities.length).toBe(1);
    expect(query.entities[0].id).toBe('a-1');
  });

  it('removes entities from index when they are deleted', () => {
    const world = createWorld();
    const entity = world.createEntity();
    entity.Agent = true;

    expect(world.with('Agent').entities).toContain(entity);

    world.removeEntity(entity);
    expect(world.with('Agent').entities).not.toContain(entity);
  });
});
