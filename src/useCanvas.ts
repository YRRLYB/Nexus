import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { framePositions, zoomAt, type Camera } from '../shared/canvas';
function initialCamera(): Camera {
  try {
    const value = JSON.parse(localStorage.getItem('nexus.camera') || 'null');
    if (
      value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      Number.isFinite(value.zoom) &&
      value.zoom >= 0.25 &&
      value.zoom <= 2
    )
      return value;
  } catch {
    /* Recover a usable view. */
  }
  return { x: 0, y: 0, zoom: 1 };
}
export function useCanvas(active: boolean) {
  const viewport = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState(initialCamera);
  const cameraRef = useRef(camera);
  const pan = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  const [panning, setPanning] = useState(false);
  function update(value: Camera) {
    cameraRef.current = value;
    setCamera(value);
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('nexus.camera', JSON.stringify(camera));
      } catch {
        /* Camera can still be used without persistence. */
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [camera]);
  useEffect(() => {
    const surface = viewport.current;
    if (!surface) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (pan.current) return;
      const rect = surface.getBoundingClientRect();
      const current = cameraRef.current;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        update({
          ...current,
          x: current.x - (event.deltaX || event.deltaY),
          y: current.y - (event.deltaX ? event.deltaY : 0),
        });
      else
        update(
          zoomAt(current, current.zoom * Math.exp(-event.deltaY * 0.002), {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }),
        );
    };
    surface.addEventListener('wheel', wheel, { passive: false });
    return () => surface.removeEventListener('wheel', wheel);
  }, [active]);
  return {
    viewport,
    camera,
    panning,
    changeZoom: (zoom: number) => {
      const rect = viewport.current?.getBoundingClientRect();
      if (rect) update(zoomAt(cameraRef.current, zoom, { x: rect.width / 2, y: rect.height / 2 }));
    },
    fit: (positions: { x: number; y: number }[]) => {
      const rect = viewport.current?.getBoundingClientRect();
      if (rect) update(framePositions(positions, rect.width, rect.height));
    },
    panStart: (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = { x: event.clientX, y: event.clientY, camera: cameraRef.current };
      setPanning(true);
    },
    panMove: (event: PointerEvent) => {
      const start = pan.current;
      if (start)
        update({
          ...start.camera,
          x: start.camera.x + event.clientX - start.x,
          y: start.camera.y + event.clientY - start.y,
        });
    },
    panEnd: (event: PointerEvent) => {
      pan.current = null;
      setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
  };
}
