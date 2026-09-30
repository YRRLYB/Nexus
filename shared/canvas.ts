export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export function zoomAt(camera: Camera, zoom: number, point: { x: number; y: number }): Camera {
  const next = Math.max(0.25, Math.min(2, zoom));
  return {
    zoom: next,
    x: point.x - ((point.x - camera.x) / camera.zoom) * next,
    y: point.y - ((point.y - camera.y) / camera.zoom) * next,
  };
}
export function framePositions(
  positions: { x: number; y: number }[],
  width: number,
  height: number,
): Camera {
  if (!positions.length) return { x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...positions.map((p) => p.x)),
    maxX = Math.max(...positions.map((p) => p.x)) + 136;
  const minY = Math.min(...positions.map((p) => p.y)),
    maxY = Math.max(...positions.map((p) => p.y)) + 140;
  const zoom = Math.max(
    0.25,
    Math.min(1, (width - 160) / (maxX - minX), (height - 210) / (maxY - minY)),
  );
  return {
    zoom,
    x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: (height - (maxY - minY) * zoom) / 2 - minY * zoom - 24,
  };
}
