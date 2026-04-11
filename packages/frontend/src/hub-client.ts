// Thin WebSocket client that bridges hub data to Jotai atoms.
// Keeps hub server agnostic to the frontend framework.

import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { sessionsAtom, type Session } from './store';

const WS_URL = 'ws://localhost:4000';
const RECONNECT_DELAY_MS = 2000;

export function useHubClient() {
  const setSessions = useSetAtom(sessionsAtom);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log('[hub-client] connected');
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as {
            type: string;
            sessions?: Session[];
          };
          if (data.type === 'init' || data.type === 'update') {
            setSessions(data.sessions ?? []);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('[hub-client] disconnected, reconnecting...');
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [setSessions]);
}
