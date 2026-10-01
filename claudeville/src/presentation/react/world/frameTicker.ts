type FrameCallback = (time: number) => void;

const subscribers = new Set<FrameCallback>();
let frameId: number | null = null;

function tick(time: number) {
  frameId = null;
  for (const callback of Array.from(subscribers)) {
    callback(time);
  }
  if (subscribers.size > 0 && frameId === null) {
    frameId = requestAnimationFrame(tick);
  }
}

export function subscribeFrame(callback: FrameCallback): () => void {
  subscribers.add(callback);
  if (frameId === null) {
    frameId = requestAnimationFrame(tick);
  }

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };
}
