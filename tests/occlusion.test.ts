import { describe, expect, it } from 'vitest';
import { fadeFor } from '@/game/occlusion';

describe('tall buildings fade in front of what the player follows (src/game/occlusion.ts)', () => {
  const tower = { id: 'ec2', depth: 500, x: 0, y: 0, w: 100, h: 250 };
  const behind = { id: 's3', depth: 100, x: 0, y: 0, w: 100, h: 250 };

  it('fades a building drawn in front of Kai whose box covers him', () => {
    expect([...fadeFor([tower, behind], [{ x: 50, y: 200, depth: 300 }])]).toEqual(['ec2']);
  });

  it('leaves buildings behind Kai, beside him, or the one being looked at', () => {
    expect(fadeFor([tower], [{ x: 50, y: 200, depth: 600 }]).size).toBe(0);
    expect(fadeFor([tower], [{ x: 150, y: 200, depth: 300 }]).size).toBe(0);
    expect(fadeFor([tower], [{ id: 'ec2', x: 50, y: 200, depth: 300 }]).size).toBe(0);
  });

  it('asks the pixel test, so the transparent margin beside a slim tower never fades it', () => {
    expect(fadeFor([tower], [{ x: 50, y: 200, depth: 300 }], () => false).size).toBe(0);
    expect(fadeFor([tower], [{ x: 50, y: 200, depth: 300 }], (id) => id === 'ec2').size).toBe(1);
  });
});
