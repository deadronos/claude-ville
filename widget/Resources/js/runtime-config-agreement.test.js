/**
 * The widget bundle cannot import shared/hub-auth.ts — it loads plain .js ES
 * modules straight from widget/Resources — so the dev auth token literal is
 * repeated in widget/Resources/js/runtime-config.js. That repetition is only
 * safe while something checks it. This file is that check.
 *
 * The failure it guards is #127: hubreceiver, the collector, and the React
 * frontend all defaulted to `dev-secret`, while the widget defaulted to empty.
 * With HUB_AUTH_TOKEN unset the widget's only hub path — the WebSocket upgrade,
 * which carries the token as ?access_token — was rejected by hubreceiver with
 * 401, so the widget never showed sessions. (The widget makes no authenticated
 * HTTP calls; its one fetch is a local sprite manifest.)
 *
 * If this ever fails, the widget literal and shared/hub-auth.ts have drifted.
 * The durable fix is to have widget/build.sh generate the widget module from the
 * shared source; until then, change both in one commit.
 */
import { describe, expect, it } from 'vitest';

// shared/hub-auth.ts is three levels up from widget/Resources/js (js ->
// Resources -> widget -> repo root), so this specifier is depth-correct and
// resolves without help. Do not shorten it to '../../shared/': that lands on
// widget/shared/, which does not exist, and it only appears to work inside a
// worktree because vitest.config.ts's repo-wide '../../shared/' alias rewrites
// the specifier before resolution — which then resolves out to the *parent*
// checkout's shared/ and masks the mistake.
import { DEV_HUB_AUTH_TOKEN, resolveHubAuthToken } from '../../../shared/hub-auth.js';
import { buildRuntimeConfig, getHubWsUrl } from './runtime-config.js';

describe('widget / server hub auth token agreement', () => {
  // One-sided drift: the widget stops agreeing, behaviour changes, these fail.
  // Covers unset and empty-string env, the two states a local dev hits.
  it.each([
    ['unset', {}],
    ['empty', { HUB_AUTH_TOKEN: '' }],
  ])('resolves the same token as hubreceiver and the collector when %s', (_label, env) => {
    expect(buildRuntimeConfig(env).hubAuthToken).toBe(resolveHubAuthToken(env));
  });

  it('never resolves to an empty token, which would drop auth entirely', () => {
    for (const env of [{}, { HUB_AUTH_TOKEN: '' }, { HUB_AUTH_TOKEN: undefined }]) {
      expect(buildRuntimeConfig(env).hubAuthToken).not.toBe('');
    }
  });

  // The pin that behavioural comparison alone cannot give: a *coordinated*
  // rename of both copies leaves runtime behaviour identical, so only checking
  // the declared value against the shared constant catches someone silently
  // changing the local-development default itself.
  it('keeps the shared local-development default from changing silently', () => {
    expect(DEV_HUB_AUTH_TOKEN).toBe('dev-secret');
  });

  // The #127 symptom, end to end: the widget's own WS URL must carry the token.
  it('puts the default token on the widget websocket url', () => {
    expect(getHubWsUrl(buildRuntimeConfig({}))).toBe(
      'ws://localhost:3030/ws?access_token=dev-secret',
    );
  });

  it('resolves the same token when the widget reads its injected config', () => {
    expect(buildRuntimeConfig({ HUB_AUTH_TOKEN: 'x' }).hubAuthToken).toBe(
      resolveHubAuthToken({ HUB_AUTH_TOKEN: 'x' }),
    );
  });
});
