import { useEffect, useRef, useState } from 'react';

import type { AgentSprite } from '../../../character-mode/AgentSprite.js';

export type AgentDebugSnapshot = {
  id: string;
  name: string;
  status: string;
  bubbleText: string | null;
  chatting: boolean;
  showUi: boolean;
  selected: boolean;
  x: number;
  y: number;
  cameraZoom: number;
};

type Props = {
  spritesRef: React.MutableRefObject<Map<string, AgentSprite>>;
  selectedAgentId: string | null;
  cameraRef: React.MutableRefObject<{ zoom: number }>;
};

export function BubbleDebugOverlay({ spritesRef, selectedAgentId, cameraRef }: Props) {
  const [visible, setVisible] = useState(false);
  const [snapshots, setSnapshots] = useState<AgentDebugSnapshot[]>([]);
  const frameRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      const out: AgentDebugSnapshot[] = [];
      for (const sprite of spritesRef.current.values()) {
        out.push({
          id: sprite.agent.id,
          name: sprite.agent.name,
          status: sprite.agent.status,
          bubbleText: sprite.agent.bubbleText,
          chatting: sprite.chatting,
          showUi: !selectedAgentId || selectedAgentId === sprite.agent.id,
          selected: sprite.agent.id === selectedAgentId,
          x: Math.round(sprite.x),
          y: Math.round(sprite.y),
          cameraZoom: cameraRef.current.zoom,
        });
      }
      setSnapshots(out);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [spritesRef, selectedAgentId, cameraRef]);

  if (!visible) {
    return (
      <button className="bubble-debug__toggle" type="button" onClick={() => setVisible(true)}>
        Debug
      </button>
    );
  }

  const maxItems = 8;

  return (
    <div className="bubble-debug__panel">
      <div className="bubble-debug__header">
        <strong className="bubble-debug__title">Bubble Debug</strong>
        <button className="bubble-debug__close" type="button" onClick={() => setVisible(false)}>
          X
        </button>
      </div>
      <div className="bubble-debug__sel-info">
        sel: <span className="bubble-debug__sel-id">{selectedAgentId ?? '(none)'}</span>
      </div>
      <table className="bubble-debug__table">
        <thead>
          <tr>
            <th className="bubble-debug__th">id</th>
            <th className="bubble-debug__th">st</th>
            <th className="bubble-debug__th">chat</th>
            <th className="bubble-debug__th">show</th>
            <th className="bubble-debug__th">text</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.slice(0, maxItems).map((s) => {
            const statusClass =
              s.status === 'idle'
                ? 'bubble-debug__status--idle'
                : s.status === 'working'
                  ? 'bubble-debug__status--working'
                  : 'bubble-debug__status--waiting';
            const textClass = s.bubbleText ? 'bubble-debug__text--ok' : 'bubble-debug__text--null';
            const rowClass = s.selected ? 'bubble-debug__tr--selected' : 'bubble-debug__tr';
            return (
              <tr key={s.id} className={rowClass}>
                <td className="bubble-debug__td bubble-debug__name" title={s.id}>
                  {s.name}
                </td>
                <td className={`bubble-debug__td bubble-debug__status ${statusClass}`}>{s.status.slice(0, 3)}</td>
                <td className="bubble-debug__td bubble-debug__chat">{s.chatting ? '💬' : '·'}</td>
                <td className="bubble-debug__td bubble-debug__show">{s.showUi ? '✓' : '✗'}</td>
                <td className={`bubble-debug__td bubble-debug__text ${textClass}`} title={s.bubbleText ?? ''}>
                  {s.bubbleText ?? '(null)'}
                </td>
              </tr>
            );
          })}
          {snapshots.length > maxItems ? (
            <tr>
              <td colSpan={5} className="bubble-debug__more">
                …{snapshots.length - maxItems} more
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
