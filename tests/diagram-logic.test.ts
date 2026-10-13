import { describe, expect, it } from 'vitest';
import { effectiveEdges, flowSteps, nextEmptyRequired, pickUp, remainingCards, tryPlace } from '@/learning/diagram';
import { edgePoints, nextSlot, pointAt, twoLines, viewBox } from '@/ui/diagram/geometry';
import type { Diagram, Puzzle } from '@/world/content';
import { puzzleById } from '@/world/content';

const d: Diagram = {
  cols: 4, rows: 2, groups: [], rejects: { ec2: 'A server bills all week.' },
  nodes: [
    { id: 'u', actor: 'users', x: 0, y: 0, role: 'Users' },
    { id: 'in', service: 's3', x: 1, y: 0, role: 'Originals' },
    { id: 'q', service: 'sqs', x: 2, y: 0, role: 'Buffer' },
    { id: 'fn', service: 'lambda', x: 3, y: 0, role: 'Resize' },
    { id: 'out', service: 's3', x: 3, y: 1, role: 'Thumbs' },
  ],
  edges: [
    { from: 'u', to: 'in', label: 'Upload', caption: 'up', step: 1 },
    { from: 'in', to: 'q', label: 'Notify', caption: 'note', step: 2 },
    { from: 'q', to: 'fn', label: 'Poll', caption: 'poll', step: 3 },
    { from: 'fn', to: 'out', label: 'Save', caption: 'save', step: 4 },
  ],
};
const p = {
  id: 't', title: 't', districtId: 'compute', tier: 1, story: '', requirements: [], why: '', flow: [],
  required: ['s3', 'lambda'], optional: ['sqs'], distractors: ['ec2'], pillarBonus: {}, diagram: d,
} as unknown as Puzzle;

describe('placing services on the diagram', () => {
  it('accepts the right service and refuses the rest with a reason', () => {
    const ok = tryPlace(p, {}, 'in', 's3');
    expect(ok).toEqual({ ok: true, placements: { in: 's3' } });
    expect(tryPlace(p, {}, 'in', 'ec2')).toMatchObject({ ok: false, reason: 'distractor', message: 'A server bills all week.' });
    expect(tryPlace(p, {}, 'fn', 's3')).toMatchObject({ ok: false, reason: 'wrong-slot' });
    const wrong = tryPlace(p, {}, 'fn', 's3');
    expect(!wrong.ok && wrong.message).toBe('S3 doesn’t fit this spot.');
    expect(tryPlace(p, { in: 's3' }, 'in', 's3')).toMatchObject({ ok: false, reason: 'taken' });
    expect(tryPlace(p, {}, 'nope', 's3')).toMatchObject({ ok: false, reason: 'no-slot' });
  });
  it('counts duplicate cards down and picks placed ones back up', () => {
    expect(remainingCards(p, {})).toMatchObject({ s3: 2, lambda: 1, sqs: 1, ec2: 1 });
    expect(remainingCards(p, { in: 's3' }).s3).toBe(1);
    expect(pickUp({ in: 's3', fn: 'lambda' }, 'in')).toEqual({ placements: { fn: 'lambda' }, service: 's3' });
  });
  it('hints the next required spot in flow order', () => {
    expect(nextEmptyRequired(p, {})?.id).toBe('in');
    expect(nextEmptyRequired(p, { in: 's3' })?.id).toBe('fn');
  });
});

describe('the flow through what you built', () => {
  it('skips an empty bonus box and keeps the incoming label', () => {
    const edges = effectiveEdges(d, { in: 's3', fn: 'lambda', out: 's3' });
    expect(edges.map((e) => `${e.from}>${e.to}:${e.label}`)).toEqual(['u>in:Upload', 'fn>out:Save', 'in>fn:Notify']);
    expect(flowSteps(edges).map((s) => s.map((e) => e.step))).toEqual([[1], [2], [4]]);
  });
  it('groups edges with the same step into one branch', () => {
    const branch = flowSteps([...d.edges, { from: 'fn', to: 'q', label: 'x', step: 4 }]);
    expect(branch.at(-1)!.length).toBe(2);
  });
  it('real puzzles flow from start to end with every bonus box empty', () => {
    const thumbs = puzzleById('thumbnails')!;
    const edges = effectiveEdges(thumbs.diagram!, { originals: 's3', resize: 'lambda', thumbs: 's3' });
    expect(edges.some((e) => e.from === 'originals' && e.to === 'resize')).toBe(true);
  });
});

describe('diagram geometry', () => {
  it('draws arrows with right angles only, trimmed to the boxes', () => {
    const pts = edgePoints(d, { from: 'fn', to: 'out', label: '' });
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
    const bent = edgePoints(d, { from: 'in', to: 'out', label: '' });
    expect(bent.length).toBe(3);
    expect(bent[1]).toEqual({ x: bent[2].x, y: bent[0].y });
  });
  it('walks a polyline evenly', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(pointAt(pts, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(pts, 0.5)).toEqual({ x: 10, y: 0 });
    expect(pointAt(pts, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAt(pts, 1)).toEqual({ x: 10, y: 10 });
  });
  it('moves focus to the nearest spot in the arrow direction', () => {
    const spots = [{ id: 'a', at: { x: 0, y: 0 } }, { id: 'b', at: { x: 100, y: 0 } }, { id: 'c', at: { x: 100, y: 100 } }, { id: 'd', at: { x: 0, y: 100 } }];
    expect(nextSlot(spots, 'a', 'ArrowRight')?.id).toBe('b');
    expect(nextSlot(spots, 'a', 'ArrowDown')?.id).toBe('d');
    expect(nextSlot(spots, 'c', 'ArrowUp')?.id).toBe('b');
    expect(nextSlot(spots, 'a', 'ArrowLeft')).toBeUndefined();
  });
  it('sizes the drawing from the grid and wraps long labels', () => {
    expect(viewBox(d)).toEqual({ w: 288, h: 208 });
    expect(twoLines('Short')).toEqual(['Short']);
    expect(twoLines('Thumbnails bucket')).toEqual(['Thumbnails', 'bucket']);
    expect(twoLines('Run containers')).toEqual(['Run containers']);
  });
});
