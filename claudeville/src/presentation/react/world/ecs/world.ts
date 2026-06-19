// Local ECS world implementation for the render path.
export type Entity = {
  id?: string;
  name?: string;
  status?: string;
  bubbleText?: string | null;
  appearance?: any;
  buildingType?: string;
  width?: number;
  height?: number;
  tileX?: number;
  tileY?: number;
  alpha?: number;
  moving?: boolean;
  targetX?: number;
  targetY?: number;
  walkFrame?: number;
  facingLeft?: boolean;
  partnerId?: string | null;
  chatting?: boolean;
  isAgent?: boolean;
  isBuilding?: boolean;
  [key: string]: any;
};

export type Query = {
  entities: Entity[];
};

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

