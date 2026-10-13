import { describe, expect, it } from 'vitest';
import { findPath, RouteCache } from '@/game/pathfinding';

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

  it('gives up (returns []) after maxExpanded tiles', () => {
    const open = () => true;
    // The whole 40x40 city core fits under the default guard, however the ties fall.
    expect(findPath({ x: 0, y: 0 }, { x: 39, y: 39 }, 40, 40, open)).toHaveLength(78);
    // A long corridor (down, across, up) needs ~300 expansions: a guard of 50 stops it.
    const corridor = (x: number, y: number) => x === 0 || y === 99 || x === 99;
    expect(findPath({ x: 0, y: 0 }, { x: 99, y: 0 }, 100, 100, corridor)).toHaveLength(297);
    expect(findPath({ x: 0, y: 0 }, { x: 99, y: 0 }, 100, 100, corridor, 50)).toEqual([]);
  });
});

describe('RouteCache', () => {
  it('finds a route once per grid version and hands out copies', () => {
    let version = 1;
    let runs = 0;
    const cache = new RouteCache(() => version);
    const find = () => (runs++, findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, 4, 4, () => true));
    const a = cache.get({ x: 0, y: 0 }, { x: 3, y: 0 }, find);
    a.shift(); // a walker consumes its copy
    expect(cache.get({ x: 0, y: 0 }, { x: 3, y: 0 }, find)).toHaveLength(3);
    expect(runs).toBe(1);
    version = 2; // decor blocked or freed a tile
    cache.get({ x: 0, y: 0 }, { x: 3, y: 0 }, find);
    expect(runs).toBe(2);
  });

  it('keeps only the most recently used routes', () => {
    const cache = new RouteCache(undefined, 2);
    for (const x of [1, 2, 3]) cache.get({ x: 0, y: 0 }, { x, y: 0 }, () => []);
    expect(cache.size).toBe(2);
  });
});
