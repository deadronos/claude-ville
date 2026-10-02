import { describe, it, expect } from 'vitest';
import { DEV_HUB_AUTH_TOKEN, resolveHubAuthToken, isDevFallbackToken } from './hub-auth.js';

describe('hub auth token', () => {
  describe('resolveHubAuthToken', () => {
    it('uses the environment value when set', () => {
      expect(resolveHubAuthToken({ HUB_AUTH_TOKEN: 'real-token' } as NodeJS.ProcessEnv)).toBe('real-token');
    });

    it('falls back to the shared dev default when unset', () => {
      expect(resolveHubAuthToken({} as NodeJS.ProcessEnv)).toBe(DEV_HUB_AUTH_TOKEN);
    });

    it('falls back when the environment value is empty', () => {
      expect(resolveHubAuthToken({ HUB_AUTH_TOKEN: '' } as NodeJS.ProcessEnv)).toBe(DEV_HUB_AUTH_TOKEN);
    });
  });

  describe('isDevFallbackToken', () => {
    it('recognises the dev default', () => {
      expect(isDevFallbackToken(DEV_HUB_AUTH_TOKEN)).toBe(true);
    });

    it('does not flag a real token', () => {
      expect(isDevFallbackToken('real-token')).toBe(false);
    });
  });

  it('resolving with no env value yields exactly the token the guard rejects', () => {
    // The public-bind guard in hubreceiver/server.ts must fire on precisely the
    // value the collector would then send. If these ever drift, a public bind
    // would silently accept a well-known token.
    //
    // Scope: this covers hubreceiver ↔ collector only. The browser's token
    // comes from the runtime-injected config and still defaults to empty, so
    // the two are not covered here — see the follow-up on that default.
    expect(isDevFallbackToken(resolveHubAuthToken({} as NodeJS.ProcessEnv))).toBe(true);
  });
});
