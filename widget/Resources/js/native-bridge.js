export function postNativeMessage(name, payload) {
  try {
    globalThis.webkit?.messageHandlers?.[name]?.postMessage(payload);
  } catch {
    // Widget resources are also loaded in ordinary browser/test environments.
  }
}

export function postBadge(counts) {
  postNativeMessage('badge', {
    type: 'badge',
    working: counts.working,
    waiting: counts.waiting,
    total: counts.total,
  });
}

export function postPetState(state) {
  postNativeMessage('petState', {
    type: 'petState',
    mood: state.mood,
    line: state.line,
  });
}

export function requestOpenDashboard() {
  postNativeMessage('openDashboard', { type: 'openDashboard' });
}

export function requestTogglePet(visible) {
  postNativeMessage('togglePet', { type: 'togglePet', visible });
}

export function requestQuit() {
  postNativeMessage('quit', { type: 'quit' });
}
