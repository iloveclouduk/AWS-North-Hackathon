import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 20;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type ImageType = 'image/jpeg' | 'image/png';

interface Entry {
  sig: string;
  contentType: ImageType;
  expires: number;
  bytes?: Buffer;
}

/**
 * Local stand-in for "POST /screenshots → presigned S3 PUT URL". The upload URL carries a one-time
 * random signature (like a presigned URL), and images live in memory for 10 minutes only.
 */
export const createUploadStore = (baseUrl: string) => {
  const entries = new Map<string, Entry>();

  const prune = () => {
    const now = Date.now();
    for (const [key, e] of entries) if (e.expires < now) entries.delete(key);
    while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  };

  return {
    create(contentType: ImageType) {
      prune();
      const screenshotKey = `screenshots/${randomUUID()}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
      const sig = randomBytes(18).toString('base64url');
      entries.set(screenshotKey, { sig, contentType, expires: Date.now() + TTL_MS });
      return { screenshotKey, uploadUrl: `${baseUrl}/uploads/${screenshotKey}?sig=${sig}` };
    },

    /** True if this signed URL is valid and unused (checked before reading the body). */
    check(screenshotKey: string, sig: string): boolean {
      const e = entries.get(screenshotKey);
      if (!e || e.bytes || e.expires < Date.now()) return false;
      const a = Buffer.from(sig);
      const b = Buffer.from(e.sig);
      return a.length === b.length && timingSafeEqual(a, b);
    },

    /** Stores the PUT body if the signature matches and nothing was uploaded yet. */
    accept(screenshotKey: string, sig: string, bytes: Buffer): boolean {
      if (!this.check(screenshotKey, sig)) return false;
      entries.get(screenshotKey)!.bytes = bytes;
      return true;
    },

    get(screenshotKey: string): { bytes: Buffer; contentType: ImageType } | undefined {
      const e = entries.get(screenshotKey);
      return e?.bytes && e.expires >= Date.now() ? { bytes: e.bytes, contentType: e.contentType } : undefined;
    },
  };
};

export type UploadStore = ReturnType<typeof createUploadStore>;
