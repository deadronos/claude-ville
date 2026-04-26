// Local ECS world implementation since miniplex v2 doesn't export createWorld
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

export class ECSWorld {
  entities: Entity[] = [];
  private byComponent: Map<string, Set<Entity>> = new Map();

  createEntity(): Entity {
    const entity: Entity = {};
    this.entities.push(entity);
    return entity;
  }

  addEntity(entity: Entity): void {
    if (!this.entities.includes(entity)) {
      this.entities.push(entity);
    }
  }

  removeEntity(entity: Entity): void {
    this.entities = this.entities.filter(e => e !== entity);
    for (const [, set] of this.byComponent) {
      set.delete(entity);
    }
  }

  with(...components: string[]): Query {
    const result: Entity[] = [];
    for (const entity of this.entities) {
      let match = true;
      for (const component of components) {
        if (!(component in entity)) {
          match = false;
          break;
        }
      }
      if (match) result.push(entity);
    }
    return { entities: result };
  }
}

export function createWorld(): ECSWorld {
  return new ECSWorld();
}