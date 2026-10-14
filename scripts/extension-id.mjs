// The unpacked extension's id comes from the manifest "key" (a public key, safe to commit): the same
// id on every machine, so the Cognito callback https://<id>.chromiumapp.org/ always matches.
// The private key is not needed for unpacked builds and was never kept.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MANIFEST_KEY = readFileSync(new URL('../extension.pubkey', import.meta.url), 'utf8').trim();

/** Chrome's id rule: sha256 of the DER public key, first 32 hex digits mapped 0-f → a-p. */
export const idFromKey = (base64Der) =>
  [...createHash('sha256').update(Buffer.from(base64Der, 'base64')).digest('hex').slice(0, 32)].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');

export const DEV_EXTENSION_ID = idFromKey(MANIFEST_KEY);

/** Firefox add-on id (browser_specific_settings.gecko.id): fixed, so the sign-in redirect URL never changes. */
export const FIREFOX_ADDON_ID = process.env.WXT_FIREFOX_ADDON_ID ?? 'aws-city@aws-city.dev';

/**
 * Firefox's identity.getRedirectURL(): https://<sha1 hex of the add-on id>.extensions.allizom.org/
 * (gecko toolkit/components/extensions/child/ext-identity.js computeHash + the
 * extensions.webextensions.identity.redirectDomain pref). Cognito needs it as a callback URL.
 */
export const firefoxRedirectUrl = (addonId = FIREFOX_ADDON_ID) => `https://${createHash('sha1').update(addonId, 'utf8').digest('hex')}.extensions.allizom.org/`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`chrome (unpacked) id:  ${DEV_EXTENSION_ID}  → https://${DEV_EXTENSION_ID}.chromiumapp.org/`);
  console.log(`firefox add-on id:     ${FIREFOX_ADDON_ID}  → ${firefoxRedirectUrl()}`);
}
