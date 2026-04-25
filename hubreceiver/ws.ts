import http from 'http';
import net from 'net';

import { computeAcceptKey } from '../shared/ws-utils.js';
import { wsSend, wsBroadcast } from '../shared/ws-helpers.js';

interface HubState {
  sessions: unknown[];
  teams: unknown[];
  taskGroups: unknown[];
  providers: unknown[];
  usage: unknown;
  timestamp: number;
}

export function createHubWebSocketManager(getCurrentState: () => HubState) {
  const wsClients = new Set<net.Socket>();

  function buildWsPayload(type: string) {
    const state = getCurrentState();
    return {
      type,
      sessions: state.sessions,
      teams: state.teams,
      taskGroups: state.taskGroups,
      providers: state.providers,
      usage: state.usage,
      timestamp: state.timestamp || Date.now(),
    };
  }

  function broadcast(type = 'update') {
    wsBroadcast(buildWsPayload(type), wsClients);
  }

  function handleUpgrade(req: http.IncomingMessage, socket: net.Socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = computeAcceptKey(key);
    const responseStr =
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey + '\r\n' +
      '\r\n';

    socket.write(responseStr, () => {
      wsClients.add(socket);
      wsSend(socket, buildWsPayload('init'));
    });

    socket.on('close', () => {
      wsClients.delete(socket);
    });

    socket.on('error', () => {
      wsClients.delete(socket);
    });
  }

  return {
    wsClients,
    buildWsPayload,
    broadcast,
    handleUpgrade,
  };
}
