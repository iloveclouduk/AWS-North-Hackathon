import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 20;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type ImageType = 'image/jpeg' | 'image/png';

/** Where the extension sends the image: a PUT (local) or a presigned POST form (S3). */
export interface UploadTarget {
  screenshotKey: string;
  uploadUrl: string;
  method: 'PUT' | 'POST';
  /** Form fields for a presigned POST (the file goes last). */
  fields?: Record<string, string>;
}

/**
 * Screenshots for the Lookout. Keys are scoped to their owner (`screenshots/<owner>/…`): `get` only
 * returns a player's own uploads, so one player can never make the Lookout read another's screenshot.
 */
export interface UploadStore {
  create(contentType: ImageType, owner: string): Promise<UploadTarget>;
  get(screenshotKey: string, owner: string): Promise<{ bytes: Buffer; contentType: ImageType } | undefined>;
}

/** Stable, non-reversible folder name for a player (never the raw Cognito sub). */
export const ownerFolder = (sub: string) => (sub === 'local' ? 'local' : createHash('sha256').update(sub).digest('hex').slice(0, 24));

const ownedBy = (key: string, owner: string) => key.startsWith(`screenshots/${ownerFolder(owner)}/`);
const extFor = (t: ImageType) => (t === 'image/png' ? 'png' : 'jpg');

interface Entry {
  sig: string;
  contentType: ImageType;
  expires: number;
  bytes?: Buffer;
}

export const UPLOAD_PATH = /^\/uploads\/(screenshots\/[a-z0-9]{1,32}\/[0-9a-f-]{36}\.(?:jpg|png))$/;

/**
 * Local stand-in for a presigned S3 upload. The upload URL carries a one-time random signature (like a
 * presigned URL), and images live in memory for 10 minutes only.
 */
export const createUploadStore = (baseUrl: string) => {
  const entries = new Map<string, Entry>();

  const prune = () => {
    const now = Date.now();
    for (const [key, e] of entries) if (e.expires < now) entries.delete(key);
    while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  };

  const check = (screenshotKey: string, sig: string): boolean => {
    const e = entries.get(screenshotKey);
    if (!e || e.bytes || e.expires < Date.now()) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(e.sig);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  return {
    async create(contentType: ImageType, owner = 'local'): Promise<UploadTarget> {
      prune();
      const screenshotKey = `screenshots/${ownerFolder(owner)}/${randomUUID()}.${extFor(contentType)}`;
      const sig = randomBytes(18).toString('base64url');
      entries.set(screenshotKey, { sig, contentType, expires: Date.now() + TTL_MS });
      return { screenshotKey, uploadUrl: `${baseUrl}/uploads/${screenshotKey}?sig=${sig}`, method: 'PUT' };
    },

    /** True if this signed URL is valid and unused (checked before reading the body). */
    check,

    /** Stores the PUT body if the signature matches and nothing was uploaded yet. */
    accept(screenshotKey: string, sig: string, bytes: Buffer): boolean {
      if (!check(screenshotKey, sig)) return false;
      entries.get(screenshotKey)!.bytes = bytes;
      return true;
    },

    async get(screenshotKey: string, owner = 'local') {
      if (!ownedBy(screenshotKey, owner)) return undefined;
      const e = entries.get(screenshotKey);
      return e?.bytes && e.expires >= Date.now() ? { bytes: e.bytes, contentType: e.contentType } : undefined;
    },
  };
};

export type MemoryUploadStore = ReturnType<typeof createUploadStore>;

/**
 * Hosted: a presigned POST straight to the private screenshots bucket. POST (not PUT) so S3 itself
 * enforces the 5 MB limit and the exact content type. The bucket expires objects after a day.
 */
export const createS3UploadStore = (deps: { s3: S3Client; bucket: string }): UploadStore => ({
  async create(contentType, owner) {
    const screenshotKey = `screenshots/${ownerFolder(owner)}/${randomUUID()}.${extFor(contentType)}`;
    const { url, fields } = await createPresignedPost(deps.s3, {
      Bucket: deps.bucket,
      Key: screenshotKey,
      Conditions: [['content-length-range', 1, MAX_UPLOAD_BYTES], ['eq', '$Content-Type', contentType]],
      Fields: { 'Content-Type': contentType },
      Expires: 300,
    });
    return { screenshotKey, uploadUrl: url, method: 'POST', fields };
  },
  async get(screenshotKey, owner) {
    if (!ownedBy(screenshotKey, owner)) return undefined;
    try {
      const out = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: screenshotKey }));
      if ((out.ContentLength ?? 0) > MAX_UPLOAD_BYTES) return undefined;
      const bytes = Buffer.from(await out.Body!.transformToByteArray());
      const contentType = out.ContentType === 'image/png' ? 'image/png' : 'image/jpeg';
      return { bytes, contentType };
    } catch {
      return undefined;
    }
  },
});
