import { getHubWsUrl } from './runtime-config.js';

const DEFAULT_RECONNECT_MS = 2_000;

export function createHubClient({
  config,
  onState,
  onConnection,
  reconnectMs = DEFAULT_RECONNECT_MS,
}) {
  let ws = null;
  let reconnectTimer = null;
  let stopped = false;

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnect();
    if (!stopped) {
      reconnectTimer = setTimeout(connect, reconnectMs);
    }
  }

  function connect() {
    if (stopped) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    ws = new WebSocket(getHubWsUrl(config));

    ws.onopen = () => {
      clearReconnect();
      onConnection?.(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'init' || message.type === 'update') {
          onState?.(message);
        }
      } catch (error) {
        console.error('[widget hub] failed to parse message', error);
      }
    };

    ws.onclose = () => {
      onConnection?.(false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      onConnection?.(false);
      try {
        ws.close();
      } catch {
        // The reconnect path below still runs if closing the socket fails.
      }
      scheduleReconnect();
    };
  }

  function stop() {
    stopped = true;
    clearReconnect();
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  }

  return { connect, stop };
}
