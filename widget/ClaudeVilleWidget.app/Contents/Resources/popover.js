import { createHubClient } from './js/hub-client.js';
import { getInjectedRuntimeConfig } from './js/runtime-config.js';
import { createPetStateReducer } from './js/pet-state.js';
import { requestOpenDashboard, requestQuit, requestTogglePet } from './js/native-bridge.js';

const config = getInjectedRuntimeConfig();
const reducer = createPetStateReducer();

const els = {
  connection: document.getElementById('connection'),
  petLine: document.getElementById('pet-line'),
  workingCount: document.getElementById('working-count'),
  countWorking: document.getElementById('count-working'),
  countWaiting: document.getElementById('count-waiting'),
  countIdle: document.getElementById('count-idle'),
  countTotal: document.getElementById('count-total'),
  togglePet: document.getElementById('toggle-pet'),
  openDashboard: document.getElementById('open-dashboard'),
  quit: document.getElementById('quit'),
};

let connected = false;
let sessions = [];
let petVisible = true;

function render(state) {
  els.connection.textContent = connected ? 'Connected' : 'Reconnecting';
  els.petLine.textContent = state.line;
  els.workingCount.textContent = String(state.counts.working);
  els.countWorking.textContent = String(state.counts.working);
  els.countWaiting.textContent = String(state.counts.waiting);
  els.countIdle.textContent = String(state.counts.idle);
  els.countTotal.textContent = String(state.counts.total);
  els.togglePet.textContent = 'Toggle Pet';
}

function update() {
  render(reducer.update({ connected, sessions }));
}

els.togglePet.addEventListener('click', () => {
  petVisible = !petVisible;
  requestTogglePet(petVisible);
  update();
});

els.openDashboard.addEventListener('click', requestOpenDashboard);
els.quit.addEventListener('click', requestQuit);

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
