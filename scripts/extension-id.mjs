// The unpacked extension's id comes from the manifest "key" (a public key, safe to commit): the same
// id on every machine, so the Cognito callback https://<id>.chromiumapp.org/ always matches.
// The private key is not needed for unpacked builds and was never kept.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const MANIFEST_KEY = readFileSync(new URL('../extension.pubkey', import.meta.url), 'utf8').trim();

/** Chrome's id rule: sha256 of the DER public key, first 32 hex digits mapped 0-f → a-p. */
export const idFromKey = (base64Der) =>
  [...createHash('sha256').update(Buffer.from(base64Der, 'base64')).digest('hex').slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');

export const DEV_EXTENSION_ID = idFromKey(MANIFEST_KEY);

if (import.meta.url === `file://${process.argv[1]}`) console.log(DEV_EXTENSION_ID);
