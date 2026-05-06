import { createHubClient } from './js/hub-client.js';
import { getInjectedRuntimeConfig } from './js/runtime-config.js';
import { createPetStateReducer } from './js/pet-state.js';
import { createSpriteAnimator } from './js/sprite-animator.js';
import { postBadge, postNativeMessage, postPetState } from './js/native-bridge.js';

const line = document.getElementById('pet-line');
const stage = document.getElementById('pet-stage');
const sprite = document.getElementById('pet-sprite');

const config = getInjectedRuntimeConfig();
const reducer = createPetStateReducer();

const manifest = await fetch('./pets/prism/manifest.json').then((response) => response.json());
const animator = createSpriteAnimator({
  element: sprite,
  manifest,
  imageUrl: './pets/prism/spritesheet.webp',
});

let connected = false;
let sessions = [];

function render(state) {
  line.textContent = state.line;
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
  postNativeMessage('openPopover', { type: 'openPopover' });
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
