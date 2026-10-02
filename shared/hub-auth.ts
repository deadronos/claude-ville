/**
 * Shared hub authentication token resolution.
 *
 * The hubreceiver (which validates) and the collector (which sends) must agree
 * on the token, so the fallback lives here rather than being repeated at each
 * call site. Previously both inlined `process.env.HUB_AUTH_TOKEN || 'dev-secret'`
 * — a security default duplicated in two files, one edit away from diverging.
 */

/**
 * The local-development fallback token. Safe only because hubreceiver refuses
 * to bind a public interface while this value is in use (see
 * `isDevFallbackToken`); it is not a credential.
 */
export const DEV_HUB_AUTH_TOKEN = 'dev-secret';

/** Resolves the hub token, falling back to the shared dev default. */
export function resolveHubAuthToken(env: NodeJS.ProcessEnv = process.env): string {
  return env.HUB_AUTH_TOKEN || DEV_HUB_AUTH_TOKEN;
}

/**
 * True when the token is still the dev fallback. hubreceiver must refuse to
 * bind `0.0.0.0` / `::` in that state, so the two checks must not drift apart.
 */
export function isDevFallbackToken(token: string): boolean {
  return token === DEV_HUB_AUTH_TOKEN;
}
