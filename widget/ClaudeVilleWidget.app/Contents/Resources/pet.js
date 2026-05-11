import { createHubClient } from './js/hub-client.js';
import { getInjectedRuntimeConfig } from './js/runtime-config.js';
import { createPetStateReducer } from './js/pet-state.js';
import { createSpriteAnimator } from './js/sprite-animator.js';
import { postBadge, postNativeMessage, postPetState } from './js/native-bridge.js';

const FALLBACK_MANIFEST = {
  atlas: { columns: 1, rows: 1, cellWidth: 192, cellHeight: 208 },
  states: {
    idle: { row: 0, frames: 1, fps: 1, loop: true },
    failed: { row: 0, frames: 1, fps: 1, loop: true },
    jumping: { row: 0, frames: 1, fps: 1, loop: true },
    running: { row: 0, frames: 1, fps: 1, loop: true },
    waiting: { row: 0, frames: 1, fps: 1, loop: true },
  },
};

const line = document.getElementById('pet-line');
const stage = document.getElementById('pet-stage');
const sprite = document.getElementById('pet-sprite');

const config = getInjectedRuntimeConfig();
const reducer = createPetStateReducer();
let manifestLoadFailed = false;

async function loadManifest() {
  try {
    const manifest = await loadJsonResource('./pets/prism/manifest.json');
    if (!manifest?.atlas || !manifest?.states) {
      throw new Error('manifest is missing atlas or states');
    }

    return manifest;
  } catch (error) {
    console.error('[pet] failed to load prism manifest', error);
    manifestLoadFailed = true;
    line.textContent = 'offline';
    line.dataset.muted = 'false';
    return FALLBACK_MANIFEST;
  }
}

async function loadJsonResource(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`manifest request failed: ${response.status}`);
    }
    return await response.json();
  } catch (fetchError) {
    return await loadJsonResourceWithXHR(url, fetchError);
  }
}

function loadJsonResourceWithXHR(url, fetchError) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.onload = () => {
      if (request.status !== 0 && (request.status < 200 || request.status >= 300)) {
        reject(new Error(`manifest request failed: ${request.status}`));
        return;
      }

      try {
        resolve(JSON.parse(request.responseText));
      } catch (parseError) {
        reject(parseError);
      }
    };
    request.onerror = () => reject(fetchError);
    request.send();
  });
}

const manifest = await loadManifest();
const animator = createSpriteAnimator({
  element: sprite,
  manifest,
  imageUrl: './pets/prism/spritesheet.webp',
});

let connected = false;
let sessions = [];
let dragState = null;

function render(state) {
  line.textContent = manifestLoadFailed && state.mood === 'offline' ? 'offline' : state.line;
  line.dataset.muted = state.mood === 'idle' && state.counts.total === 0 ? 'true' : 'false';
  animator.setState(state.animation);
  postBadge(state.counts);
  postPetState(state);
}

function update() {
  render(reducer.update({ connected, sessions }));
}

function loop() {
  animator.tick();
  requestAnimationFrame(loop);
}

function openControls() {
  if (globalThis.webkit?.messageHandlers?.openPopover) {
    postNativeMessage('openPopover', { type: 'openPopover' });
  } else {
    postNativeMessage('openDashboard', { type: 'openDashboard' });
  }
}

stage.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  stage.setPointerCapture?.(event.pointerId);
  dragState = {
    pointerId: event.pointerId,
    lastX: event.screenX,
    lastY: event.screenY,
    moved: false,
  };
});

stage.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const dx = event.screenX - dragState.lastX;
  const dy = event.screenY - dragState.lastY;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

  dragState.lastX = event.screenX;
  dragState.lastY = event.screenY;
  dragState.moved = true;
  postNativeMessage('petDrag', { type: 'petDrag', phase: 'move', dx, dy });
});

stage.addEventListener('pointerup', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  const wasDragged = dragState.moved;
  dragState = null;
  stage.releasePointerCapture?.(event.pointerId);
  postNativeMessage('petDrag', { type: 'petDrag', phase: 'end' });
  if (!wasDragged) {
    openControls();
  }
});

stage.addEventListener('pointercancel', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;

  dragState = null;
  stage.releasePointerCapture?.(event.pointerId);
  postNativeMessage('petDrag', { type: 'petDrag', phase: 'end' });
});

createHubClient({
  config,
  onConnection(nextConnected) {
    connected = nextConnected;
    update();
  },
  onState(message) {
    sessions = Array.isArray(message.sessions) ? message.sessions : [];
    update();
  },
}).connect();

update();
loop();
