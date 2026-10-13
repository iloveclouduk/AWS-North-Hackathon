import { describe, expect, it } from 'vitest';
import { CORE, fitZoom, frameTarget } from '@/game/camera';
import { CITY_ISO, toScreen } from '@/game/iso';
import { GRID, TOWN_SQUARE } from '@/world/layout';

describe('camera framing', () => {
  it('the core is the 40-tile diamond (~1280×640 at zoom 1) plus a little room', () => {
    expect(CORE.w).toBeGreaterThanOrEqual(2 * GRID * CITY_ISO.halfW);
    expect(CORE.h).toBeGreaterThanOrEqual(2 * GRID * CITY_ISO.halfH);
    expect(CORE.w).toBeLessThan(1300);
    expect(CORE.h).toBeLessThan(700);
  });

  it('the side panel (400×560) gets zoom 1 on the Town Square', () => {
    const f = frameTarget(400, 560);
    expect(f.zoom).toBe(1);
    expect(f.target).toBe('square');
    const r = TOWN_SQUARE.rect;
    expect({ x: f.x, y: f.y }).toEqual(toScreen(CITY_ISO, r.x + (r.w - 1) / 2, r.y + (r.h - 1) / 2));
  });

  it('a laptop tab (1400×880) shows the whole core at zoom 1', () => {
    expect(frameTarget(1400, 880)).toMatchObject({ zoom: 1, target: 'core' });
  });

  it('a big screen (2600×1400) gets zoom 2', () => {
    expect(frameTarget(2600, 1400)).toMatchObject({ zoom: 2, target: 'core' });
  });

  it('zoom is always a whole number in [1, 4]', () => {
    for (const [w, h] of [[300, 200], [1300, 700], [5200, 2800], [20000, 20000]]) {
      const z = frameTarget(w, h).zoom;
      expect(Number.isInteger(z)).toBe(true);
      expect(z).toBeGreaterThanOrEqual(1);
      expect(z).toBeLessThanOrEqual(4);
    }
    expect(fitZoom(20000, 20000)).toBe(4);
    expect(fitZoom(300, 200)).toBe(0);
  });
});
