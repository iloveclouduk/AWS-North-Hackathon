// Official AWS Architecture Icons (downloaded by scripts/fetch-aws-icons.mjs; manifest in shared/aws-icons.json).
// They're AWS's icons, provided for architecture diagrams — see public/assets/aws-icons/NOTICE.
import iconsJson from '../../shared/aws-icons.json' with { type: 'json' };

type Entry = Record<string, { file: string; path: string }>;
const MANIFEST = iconsJson as unknown as { source: string; zip: string; asOf: string; icons: Entry; groups?: Entry; resources?: Entry; products?: Record<string, { file: string; path: string; name: string }> };

/** Build-time switch: WXT_OFFICIAL_ICONS=false hides the official icons everywhere (UI and building signs). */
export const OFFICIAL_ICONS = (import.meta.env as unknown as Record<string, string | undefined> | undefined)?.WXT_OFFICIAL_ICONS !== 'false';
export const ICON_SOURCE = { source: MANIFEST.source, asOf: MANIFEST.asOf };
export const iconPath = (serviceId: string): string | undefined => (OFFICIAL_ICONS ? MANIFEST.icons[serviceId]?.path : undefined);
export const iconIds = () => (OFFICIAL_ICONS ? Object.keys(MANIFEST.icons) : []);
/** Diagram group box icon (cloud, region, vpc, public, private), or undefined for a pixel fallback. */
export const groupIconPath = (kind: string): string | undefined => (OFFICIAL_ICONS ? MANIFEST.groups?.[kind]?.path : undefined);
/** Diagram actor icon (users, client, mobile, internet, admin, sources), or undefined for a pixel fallback. */
export const actorIconPath = (kind: string): string | undefined => (OFFICIAL_ICONS ? MANIFEST.resources?.[kind]?.path : undefined);
/** A product drawn inside a combined landmark's box (CloudTrail, SNS, WAF) or as a fixed box (a load balancer). */
export const productIconPath = (id: string): string | undefined => (OFFICIAL_ICONS ? MANIFEST.products?.[id]?.path : undefined);
export const productName = (id: string): string | undefined => MANIFEST.products?.[id]?.name;
