import { useEffect, useRef, useState } from 'react';
import type { Application } from 'pixi.js';

import type { VillageBuilding } from '../model.js';
import { createPixiVillageApp, createPixiVillageRenderer, type PixiVillageRenderer } from '../pixi/renderVillage.js';

export function PixiVillageCanvas({
  buildings,
  selectedBuildingId,
  onSelectBuilding,
}: {
  buildings: VillageBuilding[];
  selectedBuildingId: string | null;
  onSelectBuilding: (buildingId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const rendererRef = useRef<PixiVillageRenderer | null>(null);
  const [tick, setTick] = useState(0);

  // 120ms animation tick — drives window pulse and resident bob.
  useEffect(() => {
    const interval = window.setInterval(() => setTick((v) => v + 1), 120);
    return () => window.clearInterval(interval);
  }, []);

  // Initialise PixiJS app + persistent renderer once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let disposed = false;

    void createPixiVillageApp(host).then((app) => {
      if (disposed) {
        app.destroy(true);
        return;
      }
      appRef.current = app;
      rendererRef.current = createPixiVillageRenderer(app.stage, app.screen.width, app.screen.height);
    });

    return () => {
      disposed = true;
      appRef.current?.destroy(true);
      appRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  // Forward building data to the persistent renderer every tick.
  useEffect(() => {
    rendererRef.current?.update(buildings, selectedBuildingId, onSelectBuilding, tick);
  }, [buildings, selectedBuildingId, onSelectBuilding, tick]);

  return (
    <section className="pixi-village__stage" aria-label="PixiJS ClaudeVille village map">
      <div ref={hostRef} className="pixi-village__host" />
      <div className="pixi-village__stage-badges" aria-hidden="true">
        <span>PixiJS map</span>
        <span>{buildings.filter((b) => b.agentCount > 0).length} active zones</span>
      </div>
    </section>
  );
}
