import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSOLE_SERVICE, FEATURED_REQUESTS, matchText, matchUrl, serviceById, SERVICES } from '@/world/taxonomy';
import { PLACES, tierForXp } from '@/world/places';
import { CAMPUS_PLOT, DISTRICT_PLOTS, GLOBAL_LANDMARKS, homeRectFor, inRect, isRoad, LANDMARKS, GRID } from '@/world/layout';
import { FACTS, isGlobalService } from '@/world/regions';

describe('matchUrl', () => {
  it.each([
    ['https://eu-west-2.console.aws.amazon.com/s3/buckets?region=eu-west-2', 'console', 's3'],
    ['https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/functions', 'console', 'lambda'],
    ['https://console.aws.amazon.com/iam/home#/roles', 'console', 'iam'],
    ['https://us-east-1.console.aws.amazon.com/route53/v2/home', 'console', 'route53'],
    ['https://eu-west-2.console.aws.amazon.com/dynamodbv2/home?region=eu-west-2#tables', 'console', 'dynamodb'],
    ['https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html', 'docs', 's3'],
    ['https://docs.aws.amazon.com/lambda/latest/dg/welcome.html', 'docs', 'lambda'],
  ])('%s → %s/%s', (url, kind, serviceId) => {
    expect(matchUrl(url)).toEqual({ kind, serviceId });
  });

  it('recognises the console home page', () => {
    expect(matchUrl('https://eu-west-2.console.aws.amazon.com/console/home?region=eu-west-2').kind).toBe('console-home');
  });

  it('treats other sites and extension pages separately', () => {
    expect(matchUrl('https://github.com/').kind).toBe('other');
    expect(matchUrl('chrome-extension://abc/city.html').kind).toBe('extension');
    expect(matchUrl('not a url').kind).toBe('other');
  });

  it('a malformed escape in the path never throws', () => {
    expect(() => matchUrl('https://console.aws.amazon.com/s3/%zz')).not.toThrow();
    expect(matchUrl('https://console.aws.amazon.com/s3/%zz')).toEqual({ kind: 'console', serviceId: 's3' });
    expect(matchUrl('https://docs.aws.amazon.com/%E0%A4%A/index.html').kind).toBe('docs');
  });
});

describe('matchText', () => {
  it.each([
    ['Store my holiday photos cheaply', 's3'],
    ['Run code when a file is uploaded', 'lambda'],
    ['Who can access my bucket? check the IAM policy', 'iam'],
    ['Point my domain at my website with DNS', 'route53'],
    ['Protect my site from DDoS', 'shield'],
  ])('%s → %s', (text, id) => expect(matchText(text)).toBe(id));

  it('does not route "html" to SageMaker via "ml"', () => {
    expect(matchText('fix my html page')).toBeUndefined();
  });
});

describe('world data', () => {
  it('every service has a place and a landmark inside the grid', () => {
    for (const s of SERVICES) {
      expect(PLACES.find((p) => p.serviceId === s.id), s.id).toBeTruthy();
      const l = LANDMARKS.find((x) => x.id === s.id);
      expect(l, s.id).toBeTruthy();
      expect(l!.workSpot.x).toBeLessThan(GRID);
      expect(l!.workSpot.y).toBeLessThan(GRID);
    }
  });

  it('the Global Gate (campus) holds exactly the global services, and every other service stands in its district', () => {
    const inCampus = LANDMARKS.filter((l) => serviceById(l.id) && inRect({ x: l.footprint.x, y: l.footprint.y }, CAMPUS_PLOT.rect)).map((l) => l.id);
    const globals = SERVICES.filter((s) => FACTS.global.includes(s.id)).map((s) => s.id);
    expect(globals.length).toBeGreaterThan(0);
    expect(inCampus.sort()).toEqual([...globals].sort());
    expect(GLOBAL_LANDMARKS.map((l) => l.id).sort()).toEqual([...globals].sort());
    for (const l of LANDMARKS.filter((x) => serviceById(x.id))) {
      const f = l.footprint;
      const corners = [{ x: f.x, y: f.y }, { x: f.x + f.w - 1, y: f.y + f.h - 1 }];
      const plot = isGlobalService(l.id) ? CAMPUS_PLOT.rect : DISTRICT_PLOTS[serviceById(l.id)!.districtId].rect;
      for (const c of corners) expect(inRect(c, plot), `${l.id} inside its plot`).toBe(true);
      // Its work spot is in the same plot and its agent roams there.
      expect(inRect(l.workSpot, plot), `${l.id} work spot in its plot`).toBe(true);
      expect(isRoad(l.workSpot), `${l.id} work spot on a road`).toBe(false);
      expect(homeRectFor(l.id)).toEqual(plot);
      // A global landmark keeps its district for colour and HQ.
      expect(l.districtId).toBe(serviceById(l.id)!.districtId);
    }
  });

  it('no two landmark footprints overlap', () => {
    const seen = new Map<number, string>();
    for (const l of LANDMARKS)
      for (let y = l.footprint.y; y < l.footprint.y + l.footprint.h; y++)
        for (let x = l.footprint.x; x < l.footprint.x + l.footprint.w; x++) {
          const k = y * GRID + x;
          expect(seen.get(k), `${l.id} overlaps ${seen.get(k)} at ${x},${y}`).toBeUndefined();
          seen.set(k, l.id);
        }
  });

  it('the campus keeps the fulfilment centre and the Region sign, and no downtown data centres', () => {
    expect(LANDMARKS.some((l) => l.id === 'fulfilment')).toBe(true);
    expect(LANDMARKS.some((l) => l.id === 'regionsign')).toBe(true);
    expect(LANDMARKS.some((l) => l.id.startsWith('dc:'))).toBe(false);
  });

  it('work spots are never inside a landmark footprint', () => {
    for (const l of LANDMARKS)
      for (const o of LANDMARKS) {
        const f = o.footprint;
        const inside = l.workSpot.x >= f.x && l.workSpot.x < f.x + f.w && l.workSpot.y >= f.y && l.workSpot.y < f.y + f.h;
        expect(inside, `${l.id} work spot inside ${o.id}`).toBe(false);
      }
  });

  it('featured requests and the default console name real services with a place', () => {
    for (const id of [...FEATURED_REQUESTS.map((r) => r.agent), DEFAULT_CONSOLE_SERVICE]) {
      expect(serviceById(id), id).toBeTruthy();
      expect(PLACES.find((p) => p.serviceId === id), id).toBeTruthy();
    }
  });

  it('tiers follow XP thresholds', () => {
    expect([0, 9, 10, 39, 40, 100, 199, 200, 999].map(tierForXp)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4]);
  });
});
