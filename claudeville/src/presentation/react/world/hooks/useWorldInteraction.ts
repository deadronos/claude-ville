import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from 'react';

import type { CameraModel, InteractionModel, ViewportSize } from '../types.js';
import { screenToIso } from '../utils.js';

export function useWorldInteraction({
  active,
  containerRef,
  cameraRef,
  viewportRef,
  interactionRef,
}: {
  active: boolean;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  cameraRef: MutableRefObject<CameraModel>;
  viewportRef: MutableRefObject<ViewportSize>;
  interactionRef: MutableRefObject<InteractionModel>;
}) {
  const [dragging, setDragging] = useState(false);
  const touchStateRef = useRef({
    initialDistance: 0,
    initialZoom: 0,
    centerIsoX: 0,
    centerIsoY: 0,
  });

  // Manual wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (!active) return;
      event.preventDefault();

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Get iso point under cursor before zoom
      const isoBefore = screenToIso(mouseX, mouseY, cameraRef.current, viewportRef.current);

      // Calculate new zoom
      let rawDelta = event.deltaY;
      if (event.deltaMode === 1) rawDelta *= 16;
      if (event.deltaMode === 2) rawDelta *= 100;
      const clamped = Math.max(-60, Math.min(60, rawDelta));
      const factor = 1 - clamped * 0.003;
      const newZoom = Math.max(cameraRef.current.minZoom, Math.min(cameraRef.current.maxZoom, cameraRef.current.zoom * factor));

      // Temporarily set new zoom to get iso point after
      cameraRef.current.zoom = newZoom;
      const isoAfter = screenToIso(mouseX, mouseY, cameraRef.current, viewportRef.current);

      // Adjust target to keep the iso point under cursor stationary
      cameraRef.current.targetX += isoBefore.x - isoAfter.x;
      cameraRef.current.targetZ += isoBefore.y - isoAfter.y;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [active, containerRef, cameraRef, viewportRef]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    interactionRef.current.dragging = true;
    interactionRef.current.moved = false;
    interactionRef.current.startX = event.clientX;
    interactionRef.current.startY = event.clientY;
    interactionRef.current.camStartX = cameraRef.current.targetX;
    interactionRef.current.camStartZ = cameraRef.current.targetZ;
    cameraRef.current.followAgentId = null;
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || !interactionRef.current.dragging) {
      return;
    }
    const dx = event.clientX - interactionRef.current.startX;
    const dy = event.clientY - interactionRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      interactionRef.current.moved = true;
    }
    // Pan opposite to drag direction (drag right -> world appears to move left)
    cameraRef.current.targetX = interactionRef.current.camStartX - dx / cameraRef.current.zoom;
    cameraRef.current.targetZ = interactionRef.current.camStartZ - dy / cameraRef.current.zoom;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    interactionRef.current.dragging = false;
    setDragging(false);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    interactionRef.current.dragging = false;
    setDragging(false);
  };

  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const centerX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const centerY = (t1.clientY + t2.clientY) / 2 - rect.top;
      const isoBefore = screenToIso(centerX, centerY, cameraRef.current, viewportRef.current);

      touchStateRef.current = {
        initialDistance: dist,
        initialZoom: cameraRef.current.zoom,
        centerIsoX: isoBefore.x,
        centerIsoY: isoBefore.y,
      };
    }
  };

  const onTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (active && event.touches.length === 2) {
      event.preventDefault();
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const centerX = (t1.clientX + t2.clientX) / 2 - rect.left;
      const centerY = (t1.clientY + t2.clientY) / 2 - rect.top;
      const ratio = dist / touchStateRef.current.initialDistance;

      cameraRef.current.zoom = Math.max(
        cameraRef.current.minZoom,
        Math.min(cameraRef.current.maxZoom, touchStateRef.current.initialZoom * ratio)
      );

      const isoAfter = screenToIso(centerX, centerY, cameraRef.current, viewportRef.current);
      cameraRef.current.targetX += touchStateRef.current.centerIsoX - isoAfter.x;
      cameraRef.current.targetZ += touchStateRef.current.centerIsoY - isoAfter.y;
    }
  };

  const onTouchEnd = () => {
    touchStateRef.current.initialDistance = 0;
  };

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
