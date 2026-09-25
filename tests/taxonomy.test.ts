import { describe, expect, it } from 'vitest';
import { matchText, matchUrl, SERVICES } from '@/world/taxonomy';
import { PLACES, tierForXp } from '@/world/places';
import { LANDMARKS, GRID } from '@/world/layout';

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

  it('work spots are never inside a landmark footprint', () => {
    for (const l of LANDMARKS)
      for (const o of LANDMARKS) {
        const f = o.footprint;
        const inside = l.workSpot.x >= f.x && l.workSpot.x < f.x + f.w && l.workSpot.y >= f.y && l.workSpot.y < f.y + f.h;
        expect(inside, `${l.id} work spot inside ${o.id}`).toBe(false);
      }
  });

  it('tiers follow XP thresholds', () => {
    expect([0, 9, 10, 39, 40, 100, 199, 200, 999].map(tierForXp)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4]);
  });
});
