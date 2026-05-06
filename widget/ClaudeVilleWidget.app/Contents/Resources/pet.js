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
    const response = await fetch('./pets/prism/manifest.json');
    if (!response.ok) {
      throw new Error(`manifest request failed: ${response.status}`);
    }

    const manifest = await response.json();
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

const manifest = await loadManifest();
const animator = createSpriteAnimator({
  element: sprite,
  manifest,
  imageUrl: './pets/prism/spritesheet.webp',
});

let connected = false;
let sessions = [];

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

stage.addEventListener('click', () => {
  if (globalThis.webkit?.messageHandlers?.openPopover) {
    postNativeMessage('openPopover', { type: 'openPopover' });
  } else {
    postNativeMessage('openDashboard', { type: 'openDashboard' });
  }
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
