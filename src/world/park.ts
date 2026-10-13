// re:Play Park: an AWS theme park outside the gate, where every ride is a service you've learned. A ride opens when its
// building reaches Practitioner in this city (tier 2); until then it stands under wraps with a sign saying what opens it.
// The site comes from the terrain (src/world/terrain.ts `park`, the same per Region every time); this module lays the
// rides out on it and says which are open. Pure, so it's tested without Phaser (tests/park.test.ts).
import type { Progress } from '@/backend/contract';
import { landmarkOf } from '@/state/cities';
import { placeFor, TIER_NAMES, tierForXp } from '@/world/places';
import type { Rect } from './layout';

/** A ride opens at this building tier (Practitioner). */
export const RIDE_TIER = 2;
/** The park's footprint: three rides across, two deep, and the entrance row in front. */
export const PARK_W = 6;
export const PARK_H = 5;

export interface Ride {
  id: string;
  name: string;
  serviceId: string;
  /** Animation frames (park:<id>0..n-1), or 0 for one still sprite (park:<id>). */
  frames: number;
}

export const RIDES: Ride[] = [
  { id: 'wheel', name: 'EventBridge Ferris Wheel', serviceId: 'eventbridge', frames: 3 },
  { id: 'coaster', name: 'Lambda Coaster', serviceId: 'lambda', frames: 0 },
  { id: 'droptower', name: 'CloudFront Drop Tower', serviceId: 'cloudfront', frames: 0 },
  { id: 'carousel', name: 'Route 53 Carousel', serviceId: 'route53', frames: 3 },
  { id: 'flume', name: 'S3 Log Flume', serviceId: 's3', frames: 3 },
  { id: 'teacups', name: 'SQS Teacups', serviceId: 'sqs', frames: 3 },
];

export interface ParkPiece {
  sprite: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ride?: Ride;
  open?: boolean;
}

/** True when this ride's building has reached Practitioner in the city being shown. */
export function rideOpen(p: Progress, ride: Ride, region?: string) {
  return tierForXp(landmarkOf(p, ride.serviceId, region)?.xp ?? 0) >= RIDE_TIER && !!landmarkOf(p, ride.serviceId, region)?.discovered;
}

/** "Reach Practitioner at Lambda Kitchen to open the Lambda Coaster". */
export const rideHint = (ride: Ride) => `Reach ${TIER_NAMES[RIDE_TIER]} at ${placeFor(ride.serviceId)?.place ?? ride.serviceId} to open the ${ride.name}`;

/** Everything on the site: six rides (open or under wraps), the entrance arch, a ticket booth and fences. */
export function parkLayout(site: Rect, p: Progress, region?: string): ParkPiece[] {
  const pieces: ParkPiece[] = RIDES.map((ride, i) => {
    const open = rideOpen(p, ride, region);
    const still = ride.frames ? `park:${ride.id}0` : `park:${ride.id}`;
    return { sprite: open ? still : `park:${ride.id}:locked`, x: site.x + (i % 3) * 2, y: site.y + Math.floor(i / 3) * 2, w: 2, h: 2, ride, open };
  });
  const front = site.y + 4;
  pieces.push({ sprite: 'park:fenceX', x: site.x, y: front, w: 1, h: 1 }, { sprite: 'park:fenceX', x: site.x + 1, y: front, w: 1, h: 1 });
  pieces.push({ sprite: 'park:arch', x: site.x + 2, y: front, w: 2, h: 1 });
  pieces.push({ sprite: 'park:booth', x: site.x + 4, y: front, w: 1, h: 1 }, { sprite: 'park:fenceX', x: site.x + 5, y: front, w: 1, h: 1 });
  return pieces;
}

/** How many rides are open (the park's sign counts them). */
export const openRides = (p: Progress, region?: string) => RIDES.filter((r) => rideOpen(p, r, region)).length;
