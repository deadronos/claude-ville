import { useEffect, useRef, useState } from 'react';
import type { Application } from 'pixi.js';

import type { VillageBuilding } from '../model.js';
import { createPixiVillageApp, renderVillage } from '../pixi/renderVillage.js';

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
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 120);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    if (!host) return undefined;

    void createPixiVillageApp(host).then((app) => {
      if (disposed) {
        app.destroy(true);
        return;
      }
      appRef.current = app;
    });

    return () => {
      disposed = true;
      appRef.current?.destroy(true);
      appRef.current = null;
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    renderVillage(app.stage, app.screen.width, app.screen.height, buildings, {
      selectedBuildingId,
      onSelectBuilding,
      tick,
    });
  }, [buildings, selectedBuildingId, onSelectBuilding, tick]);

  return (
    <section className="pixi-village__stage" aria-label="PixiJS ClaudeVille village map">
      <div ref={hostRef} className="pixi-village__host" />
      <div className="pixi-village__stage-badges" aria-hidden="true">
        <span>PixiJS map</span>
        <span>{buildings.filter((building) => building.agentCount > 0).length} active zones</span>
      </div>
    </section>
  );
}
