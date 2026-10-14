import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Config } from './config.js';

/** Who is calling. `local` is the single player of the local server (token mode). */
export interface Principal {
  sub: string;
  /** Cognito username: the sub for email sign-ups, e.g. google_123 for federated players (Admin* APIs need it). */
  username?: string;
  email?: string;
  /** When the token proving this expires (epoch ms); the socket must not outlive it for long. */
  expiresAt?: number;
}

/** Resolves the caller or undefined (→ 401). Never throws for a bad token. */
export type Authenticate = (req: IncomingMessage, url: URL) => Promise<Principal | undefined>;

/** The browser WebSocket API can't set headers, so the JWT rides in Sec-WebSocket-Protocol (see bearerSubprotocols in the contract). */
export const BEARER_PROTOCOL = 'base64UrlBearerAuthorization';

export const bearerFromProtocols = (header: string | undefined): string | undefined => {
  for (const p of (header ?? '').split(',').map((s) => s.trim())) {
    if (p.startsWith(`${BEARER_PROTOCOL}.`)) {
      try {
        return Buffer.from(p.slice(BEARER_PROTOCOL.length + 1), 'base64url').toString('utf8');
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/**
 * Local server: a caller with the token, or (only when EXTENSION_ORIGIN is pinned) the pinned extension
 * itself. Browsers don't let web pages forge Origin, and token mode only listens on loopback.
 */
export const tokenAuth = (config: Config): Authenticate => {
  const pinned = config.extensionOrigins.length > 0;
  return async (req) => {
    // Never from the query string: URLs end up in logs and history.
    const bearer = req.headers.authorization?.replace(/^Bearer /, '') ?? bearerFromProtocols(req.headers['sec-websocket-protocol']);
    if (bearer) return safeEqual(bearer, config.token) ? { sub: 'local' } : undefined;
    // Exact origins only: a scheme wildcard (moz-extension://*) would let ANY Firefox extension in without the token.
    return pinned && req.headers.origin !== undefined && config.extensionOrigins.includes(req.headers.origin) ? { sub: 'local' } : undefined;
  };
};

export interface JwtVerifier {
  verify(token: string): Promise<{ sub: string; username?: string; email?: unknown; exp?: number }>;
}

/**
 * Hosted: a Cognito access token for our app client, from Authorization: Bearer (REST) or the
 * WebSocket subprotocol. Never from the query string — URLs end up in access logs.
 */
export const cognitoAuth = (config: Config, verifier?: JwtVerifier): Authenticate => {
  const v: JwtVerifier =
    verifier ?? CognitoJwtVerifier.create({ userPoolId: config.cognito!.userPoolId, clientId: config.cognito!.clientId, tokenUse: 'access' });
  return async (req) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : bearerFromProtocols(req.headers['sec-websocket-protocol']);
    if (!token) return undefined;
    try {
      const claims = await v.verify(token);
      return {
        sub: claims.sub,
        username: claims.username,
        email: typeof claims.email === 'string' ? claims.email : undefined,
        expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : undefined,
      };
    } catch {
      return undefined;
    }
  };
};

export const createAuthenticate = (config: Config): Authenticate => (config.authMode === 'cognito' ? cognitoAuth(config) : tokenAuth(config));
