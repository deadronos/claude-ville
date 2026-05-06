export function getStateDefinition(manifest, stateName) {
  const states = manifest?.states || {};
  return states[stateName] || states.idle || Object.values(states)[0];
}

export function getFrameStyle(manifest, stateName, frameIndex) {
  const state = getStateDefinition(manifest, stateName);
  const atlas = manifest.atlas;
  const column = Math.max(0, Math.min(state.frames - 1, frameIndex));
  const x = column * atlas.cellWidth;
  const y = state.row * atlas.cellHeight;

  return {
    width: `${atlas.cellWidth}px`,
    height: `${atlas.cellHeight}px`,
    backgroundSize: `${atlas.columns * atlas.cellWidth}px ${atlas.rows * atlas.cellHeight}px`,
    backgroundPosition: `-${x}px -${y}px`,
  };
}

export function createSpriteAnimator({ element, manifest, imageUrl, now = () => performance.now() }) {
  let stateName = 'idle';
  let startedAt = now();
  let frame = 0;

  element.style.backgroundImage = `url("${imageUrl}")`;
  element.style.backgroundRepeat = 'no-repeat';
  Object.assign(element.style, getFrameStyle(manifest, stateName, frame));

  function setState(nextState) {
    if (nextState === stateName) return;
    stateName = nextState;
    startedAt = now();
    frame = 0;
    Object.assign(element.style, getFrameStyle(manifest, stateName, frame));
  }

  function tick() {
    const state = getStateDefinition(manifest, stateName);
    const elapsed = Math.max(0, now() - startedAt);
    const rawFrame = Math.floor((elapsed / 1000) * state.fps);
    frame = state.loop ? rawFrame % state.frames : Math.min(state.frames - 1, rawFrame);
    Object.assign(element.style, getFrameStyle(manifest, stateName, frame));
  }

  return { setState, tick };
}
