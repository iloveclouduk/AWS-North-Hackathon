import { describe, expect, it } from 'vitest';
import { findPath } from '@/game/pathfinding';

describe('findPath', () => {
  it('walks around a wall', () => {
    const wall = new Set(['1,0', '1,1', '1,2']);
    const path = findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, 4, 4, (x, y) => !wall.has(`${x},${y}`));
    expect(path.at(-1)).toEqual({ x: 2, y: 0 });
    expect(path.some((t) => wall.has(`${t.x},${t.y}`))).toBe(false);
    expect(path).toHaveLength(8);
  });

  it('returns [] when unreachable', () => {
    expect(findPath({ x: 0, y: 0 }, { x: 3, y: 3 }, 4, 4, (x) => x < 2)).toEqual([]);
  });
});
