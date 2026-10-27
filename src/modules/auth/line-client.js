import { createHash } from 'node:crypto';

export const pkceChallenge = (verifier) =>
  createHash('sha256').update(verifier).digest('base64url');

export function authorizationUrl(config, { state, nonce, verifier }) {
  const url = new URL('https://access.line.me/oauth2/v2.1/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.channelId,
    redirect_uri: config.callbackUrl,
    state,
    nonce,
    scope: 'openid profile',
    bot_prompt: 'normal',
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export async function verifyLineIdentity(config, { code, nonce, verifier }, fetcher = fetch) {
  async function post(path, data) {
    const response = await fetcher(`https://api.line.me/oauth2/v2.1/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('LINE_REQUEST_FAILED');
    return response.json();
  }
  const token = await post('token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.callbackUrl,
    client_id: config.channelId,
    client_secret: config.channelSecret,
    code_verifier: verifier,
  });
  if (typeof token.id_token !== 'string') throw new Error('LINE_ID_TOKEN_MISSING');
  // LINE verifies the signature; also enforce audience, nonce, issuer and expiry here.
  const claims = await post('verify', {
    id_token: token.id_token,
    client_id: config.channelId,
    nonce,
  });
  if (
    claims.iss !== 'https://access.line.me' ||
    claims.aud !== config.channelId ||
    claims.nonce !== nonce ||
    typeof claims.exp !== 'number' ||
    claims.exp <= Date.now() / 1000 ||
    typeof claims.sub !== 'string' ||
    !/^U[0-9a-f]{32}$/.test(claims.sub)
  )
    throw new Error('LINE_IDENTITY_INVALID');
  if (typeof claims.name !== 'string' || !claims.name.trim() || claims.name.length > 256)
    throw new Error('LINE_PROFILE_INVALID');
  return { lineUserId: claims.sub, displayName: claims.name.trim() };
}
