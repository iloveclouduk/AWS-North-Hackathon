// The frontend owns the contract and the city's content. The server imports them directly, so a
// contract change on the frontend breaks this build instead of silently drifting.
export * from '../../src/backend/contract.js';
export { DISTRICTS, SERVICES, districtById, matchText, serviceById, servicesIn, type DistrictId } from '../../src/world/taxonomy.js';
export { placeFor } from '../../src/world/places.js';

import type { Service as AwsService } from './state/model.js';

/** Poller services → city agent ids (taxonomy service ids). API Gateway has no landmark yet. */
export const AGENT_FOR_SERVICE: Record<AwsService, string | undefined> = {
  ec2: 'ec2',
  dynamodb: 'dynamodb',
  s3: 's3',
  lambda: 'lambda',
  rds: 'rds',
  apigateway: undefined,
};
