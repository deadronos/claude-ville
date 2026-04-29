/* Small local component helper for the render-path ECS. */
interface Component<T> {
  create(values?: Partial<T>): T;
  properties: T;
}

function component<T extends object>(defaults: T): Component<T> {
  return {
    create(values?: Partial<T>): T {
      const merged: T = { ...defaults };
      const source: Partial<T> = values ?? {};
      for (const key of Object.keys(source) as Array<keyof T>) {
        const v = source[key];
        const d = (merged as any)[key];
        if (d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' && !Array.isArray(v)) {
          (merged as any)[key] = { ...d, ...v };
        } else {
          (merged as any)[key] = v;
        }
      }
      return merged as T;
    },
    properties: defaults,
  };
}

export const Position = component({ x: 0, y: 0, z: 0 });
export const Agent = component({
  id: '',
  name: '',
  status: 'idle',
  bubbleText: null as string | null,
  appearance: {
    hairStyle: 'short',
    hair: '#000',
    skin: '#fff',
    shirt: '#fff',
    pants: '#000',
    eyeStyle: 'normal',
    accessory: 'none',
  },
});
export const Selection = component({ selected: false });
export const Building = component({
  type: '',
  width: 0,
  height: 0,
  tileX: 0,
  tileY: 0,
});
export const RoofAlpha = component({ alpha: 1 });
export const Movement = component({
  targetX: 0,
  targetY: 0,
  moving: false,
  walkFrame: 0,
  facingLeft: false,
});
export const ChatPartner = component({
  partnerId: null as string | null,
  chatting: false,
});
