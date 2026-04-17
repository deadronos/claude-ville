import { useWorldTimer } from '../hooks/useWorldTimer.js';

export function WorldTimer({ startTime }: { startTime: number }) {
  const runtime = useWorldTimer(startTime);

  return <span id="statTime" className="topbar__stat-value">{runtime}</span>;
}
