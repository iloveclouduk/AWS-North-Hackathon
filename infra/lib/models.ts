/**
 * Claude on Bedrock through a geographic cross-Region inference profile (`<geo>.anthropic.<model>`). The geo prefix
 * depends on the Region the server runs in, and not every Region has one: these are the source Regions AWS lists
 * ("Geo inference details" on https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html,
 * .../model-card-anthropic-claude-sonnet-5-5.html, and the Claude Opus 5 / Sonnet 5 cards, checked 2026-10-12).
 * Claude Opus 5.5 and Sonnet 5.5 have `us.`, `eu.` and `au.` profiles (Opus 5.5 also `jp.`, Sonnet 5.5 not); India has
 * no 5.5 profile, so `in.` keeps Claude Opus 5 / Sonnet 5 (still active). There is no `apac.` profile. GovCloud is
 * left out (another partition; our ARNs are arn:aws:).
 *
 * Plain erasable TypeScript, no imports: infra/setup/setup.mjs imports this file directly (Node 24 strips the types).
 */
export const GEO_SOURCE_REGIONS = {
  us: ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'ca-west-1'],
  eu: ['eu-central-1', 'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2', 'eu-west-1', 'eu-west-2', 'eu-west-3'],
  au: ['ap-southeast-2', 'ap-southeast-4'],
  in: ['ap-south-1', 'ap-south-2'],
} as const satisfies Record<string, readonly string[]>;

export type Geo = keyof typeof GEO_SOURCE_REGIONS;

export const SUPPORTED_REGIONS: readonly string[] = Object.values(GEO_SOURCE_REGIONS).flat();

/** The inference-profile geo for a Region, or undefined where the server's models have no geo profile. */
export const geoFor = (region: string): Geo | undefined =>
  (Object.keys(GEO_SOURCE_REGIONS) as Geo[]).find((g) => (GEO_SOURCE_REGIONS[g] as readonly string[]).includes(region));

export const unsupportedRegionMessage = (region: string) =>
  `Claude has no Bedrock geo inference profile in ${region} for both of the server's models. Deploy in one of: ${SUPPORTED_REGIONS.join(', ')}.`;

/** Each geo's main and light model: the newest pair that has a profile there for both. */
export const GEO_MODELS = {
  us: { main: 'claude-opus-5-5', light: 'claude-sonnet-5-5' },
  eu: { main: 'claude-opus-5-5', light: 'claude-sonnet-5-5' },
  au: { main: 'claude-opus-5-5', light: 'claude-sonnet-5-5' },
  in: { main: 'claude-opus-5', light: 'claude-sonnet-5' },
} as const satisfies Record<Geo, { main: string; light: string }>;

/** The server's two models as inference-profile ids for this Region; throws where there are none. */
export const modelsFor = (region: string): { main: string; light: string } => {
  const geo = geoFor(region);
  if (!geo) throw new Error(unsupportedRegionMessage(region));
  const m = GEO_MODELS[geo];
  return { main: `${geo}.anthropic.${m.main}`, light: `${geo}.anthropic.${m.light}` };
};

/** The foundation model behind a profile id: us.anthropic.claude-opus-5-5 → anthropic.claude-opus-5-5. */
export const foundationModel = (profileId: string) => profileId.replace(/^[a-z]+\.(?=anthropic\.)/, '');
