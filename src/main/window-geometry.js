'use strict';

const EDGES = new Set(['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']);

function gestureBounds(start, mode, edge, dx, dy, minimum) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (mode === 'move') return { ...start, x: Math.round(start.x + dx), y: Math.round(start.y + dy) };
  if (mode !== 'resize' || !EDGES.has(edge)) return null;
  const result = { ...start };
  if (edge.includes('e')) result.width = Math.max(minimum[0], Math.round(start.width + dx));
  if (edge.includes('s')) result.height = Math.max(minimum[1], Math.round(start.height + dy));
  if (edge.includes('w')) {
    result.width = Math.max(minimum[0], Math.round(start.width - dx));
    result.x = start.x + start.width - result.width;
  }
  if (edge.includes('n')) {
    result.height = Math.max(minimum[1], Math.round(start.height - dy));
    result.y = start.y + start.height - result.height;
  }
  return result;
}

module.exports = { gestureBounds, EDGES };
