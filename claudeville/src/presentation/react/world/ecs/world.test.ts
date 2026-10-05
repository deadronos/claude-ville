import { describe, it, expect } from 'vitest';
import { createWorld } from './world.js';
import type { Entity } from './world.js';

/**
 * `wrapEntity`'s `set` trap removes a component when the assigned value is
 * `null` OR `undefined`, but `Entity` declares only some fields as nullable
 * (`moving?: boolean`), so assigning `null` to the rest is a type error even
 * though the proxy handles it. The two cases below are the `null` path
 * specifically — `undefined` takes the same `if` branch but is not the value
 * under test — so they go through here. The declaration gap is reported rather
 * than fixed: the fix is `moving?: boolean | null` on the production type.
 */
function removeComponent(entity: Entity, name: 'moving') {
  (entity as Record<string, unknown>)[name] = null;
}

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
    removeComponent(entity, 'moving');
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

    removeComponent(e2, 'moving'); // Remove moving from e2
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
