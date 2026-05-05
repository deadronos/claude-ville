import { describe, expect, it } from 'vitest';

import { buildVoxelVillageSnapshot } from './model.js';
import type { HubSession } from '../pixivillage/model.js';

describe('voxel village model mapping', () => {
  it('places agents around their assigned voxel building with deterministic offsets', () => {
    const now = Date.now();
    const sessions: HubSession[] = [
      {
        sessionId: 'session-a',
        provider: 'copilot',
        status: 'active',
        lastActivity: now,
        lastTool: 'Read',
        currentTask: 'Reading architecture notes',
      },
      {
        sessionId: 'session-b',
        provider: 'copilot',
        status: 'active',
        lastActivity: now,
        lastTool: 'Read',
        currentTask: 'Checking frontend files',
      },
    ];

    const snapshot = buildVoxelVillageSnapshot(sessions, now);
    const first = snapshot.agents[0];
    const second = snapshot.agents[1];
    const building = snapshot.buildings.find((candidate) => candidate.id === first.buildingId);

    expect(building).toBeTruthy();
    expect(first.voxelPosition.y).toBe(0);
    expect(second.voxelPosition.y).toBe(0);
    expect(first.voxelPosition.x).not.toBe(second.voxelPosition.x);
    expect(first.voxelPosition.z).not.toBe(second.voxelPosition.z);
    expect(Math.abs(first.voxelPosition.x - building!.voxelPosition.x)).toBeLessThanOrEqual(2.4);
    expect(Math.abs(first.voxelPosition.z - building!.voxelPosition.z)).toBeLessThanOrEqual(2.4);
  });

  it('exposes a walkable road grid for the voxel scene', () => {
    const snapshot = buildVoxelVillageSnapshot([], Date.now());

    expect(snapshot.roads.length).toBeGreaterThan(12);
    expect(snapshot.roads).toContainEqual({ x: 0, z: 0 });
    expect(snapshot.roads.some((road) => road.x === 8 && road.z === 0)).toBe(true);
    expect(snapshot.roads.some((road) => road.x === 0 && road.z === 8)).toBe(true);
  });

  it('derives doorway and road anchors plus faster motion for busier agents', () => {
    const now = Date.now();
    const snapshot = buildVoxelVillageSnapshot([
      {
        sessionId: 'busy-agent',
        provider: 'codex',
        status: 'active',
        lastActivity: now - 5_000,
        lastTool: 'Edit',
        messageCount: 12,
        detail: {
          toolHistory: [
            { tool: 'Read', ts: now - 50_000 },
            { tool: 'Grep', ts: now - 35_000 },
            { tool: 'Edit', ts: now - 8_000 },
            { tool: 'Write', ts: now - 1_500 },
          ],
        },
      },
      {
        sessionId: 'slow-agent',
        provider: 'codex',
        status: 'inactive',
        lastActivity: now - 420_000,
        messageCount: 1,
      },
    ], now);

    const busyAgent = snapshot.agents.find((agent) => agent.id === 'busy-agent');
    const slowAgent = snapshot.agents.find((agent) => agent.id === 'slow-agent');

    expect(busyAgent).toBeTruthy();
    expect(slowAgent).toBeTruthy();
    expect(busyAgent!.roadAnchorPosition.y).toBe(0);
    expect(busyAgent!.doorwayPosition.z).toBeGreaterThan(busyAgent!.homePosition.z - 0.5);
    expect(snapshot.roads).toContainEqual({ x: busyAgent!.roadAnchorPosition.x, z: busyAgent!.roadAnchorPosition.z });
    expect(busyAgent!.walkSpeed).toBeGreaterThan(slowAgent!.walkSpeed);
    expect(busyAgent!.dwellDurationMs).toBeLessThan(slowAgent!.dwellDurationMs);
  });
});
