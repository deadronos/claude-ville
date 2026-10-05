// Local ECS world implementation for the render path.
import type { Appearance } from '../../../../domain/value-objects/Appearance.js';
//
// The optional fields below are the component payload from `components.ts`. An
// entity is a bare `{}` when `createEntity` returns it and each component key is
// added later, so "absent" is a real state and every one of these is genuinely
// `number | undefined` until something writes it. Declaring them is what lets
// `systems.ts` read and write them without a cast at each use.
export type Entity = {
  /** Query flags: `with('Agent')` matches on the key being present and truthy. */
  Agent?: boolean;
  Building?: boolean;
  id?: string;
  name?: string;
  status?: string;
  bubbleText?: string | null;
  /** `Appearance`, assigned by `useEcsWorld` for agents only — a building entity has none. */
  appearance?: Appearance;
  /** `Position`. */
  x?: number;
  y?: number;
  z?: number;
  buildingType?: string;
  width?: number;
  height?: number;
  tileX?: number;
  tileY?: number;
  alpha?: number;
  /** `Movement`. */
  moving?: boolean;
  targetX?: number;
  targetY?: number;
  walkFrame?: number;
  facingLeft?: boolean;
  partnerId?: string | null;
  chatting?: boolean;
  isAgent?: boolean;
  isBuilding?: boolean;
  [key: string]: unknown;
};

export type Query = {
  entities: Entity[];
};

/**
 * The render contract `useEcsWorld`'s agent path establishes unconditionally
 * (`useEcsWorld.ts`: `id`/:55, `name`/:56, `status`/:57, `bubbleText`/:58,
 * `appearance`/:59, `Agent`/:60). Everything else on `Entity` (`x`, `y`,
 * `targetX`, `targetY`, `moving`, `walkFrame`, `facingLeft`, `z`, `chatting`, …)
 * stays optional: positions are set only on first creation, motion fields are
 * written later by the movement system, and `createEntity` starts from `{}`.
 *
 * Owned here (next to `Entity`) so both `useEcsWorld` and `AgentActor` share
 * one declaration: `world.ts` imports only the `Appearance` type, so neither
 * consumer can create an import cycle by depending on it.
 */
export type AgentEntity = Entity & {
  Agent: true;
  id: string;
  name: string;
  status: string;
  bubbleText: string | null;
  appearance: Appearance;
};

/** Proves what `useEcsWorld` establishes; checks every `AgentEntity` field. */
export function isAgentEntity(entity: Entity): entity is AgentEntity {
  return (
    entity.Agent === true &&
    typeof entity.id === 'string' &&
    typeof entity.name === 'string' &&
    typeof entity.status === 'string' &&
    (entity.bubbleText === null || typeof entity.bubbleText === 'string') &&
    typeof entity.appearance === 'object' &&
    entity.appearance !== null
  );
}

const IS_PROXY = Symbol('is_proxy');

export class ECSWorld {
  entities: Entity[] = [];
  private byComponent: Map<string, Set<Entity>> = new Map();

  private wrapEntity(entity: Entity): Entity {
    const proxy = new Proxy(entity, {
      get(target, prop, receiver) {
        if (prop === IS_PROXY) return true;
        return Reflect.get(target, prop, receiver);
      },
      set: (target, prop, value, receiver) => {
        const propStr = String(prop);
        if (value === undefined || value === null) {
          const set = this.byComponent.get(propStr);
          if (set) {
            set.delete(receiver);
          }
        } else {
          let set = this.byComponent.get(propStr);
          if (!set) {
            set = new Set();
            this.byComponent.set(propStr, set);
          }
          set.add(receiver);
        }
        return Reflect.set(target, prop, value, receiver);
      },
      deleteProperty: (target, prop) => {
        const propStr = String(prop);
        const set = this.byComponent.get(propStr);
        if (set) {
          set.delete(proxy);
        }
        return Reflect.deleteProperty(target, prop);
      }
    });
    return proxy;
  }

  createEntity(): Entity {
    const entity: Entity = {};
    return this.wrapEntity(entity);
  }

  addEntity(entity: Entity): void {
    let proxy = entity;
    if (!(entity as any)[IS_PROXY]) {
      proxy = this.wrapEntity(entity);
    }
    if (!this.entities.includes(proxy)) {
      this.entities.push(proxy);
      // Index any existing properties
      for (const key of Object.keys(proxy)) {
        if (proxy[key] !== undefined && proxy[key] !== null) {
          let set = this.byComponent.get(key);
          if (!set) {
            set = new Set();
            this.byComponent.set(key, set);
          }
          set.add(proxy);
        }
      }
    }
  }

  removeEntity(entity: Entity): void {
    this.entities = this.entities.filter(e => e !== entity);
    for (const [, set] of this.byComponent) {
      set.delete(entity);
    }
  }

  with(...components: string[]): Query {
    if (components.length === 0) {
      return { entities: [] };
    }

    const sets = components.map(c => this.byComponent.get(c));
    if (sets.some(s => !s || s.size === 0)) {
      return { entities: [] };
    }

    // Sort sets by size to optimize intersection
    const sortedSets = (sets as Set<Entity>[]).sort((a, b) => a.size - b.size);
    const smallestSet = sortedSets[0];
    const result: Entity[] = [];

    for (const entity of smallestSet) {
      let match = true;
      for (let i = 1; i < sortedSets.length; i++) {
        if (!sortedSets[i].has(entity)) {
          match = false;
          break;
        }
      }
      if (match) {
        result.push(entity);
      }
    }

    return { entities: result };
  }
}

export function createWorld(): ECSWorld {
  return new ECSWorld();
}

