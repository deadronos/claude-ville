/* Miniplex v2 does not export a component() function, so we implement one */
interface Component<T> {
  create(values?: Partial<T>): T;
  properties: T;
}

function component<T extends object>(defaults: T): Component<T> {
  return {
    create(values?: Partial<T>): T {
      return { ...defaults, ...values } as T;
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