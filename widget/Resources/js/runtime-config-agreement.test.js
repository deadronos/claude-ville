/**
 * The widget bundle cannot import shared/hub-auth.ts — it loads plain .js ES
 * modules straight from widget/Resources — so the dev auth token literal is
 * repeated in widget/Resources/js/runtime-config.js. That repetition is only
 * safe while something checks it. This file is that check.
 *
 * The failure it guards is #127: hubreceiver, the collector, and the React
 * frontend all defaulted to `dev-secret`, while the widget defaulted to empty,
 * so with HUB_AUTH_TOKEN unset the widget sent no Authorization header and no
 * access_token — 401 on every read, rejected WebSocket upgrade.
 *
 * If this ever fails, either the widget literal or shared/hub-auth.ts drifted.
 * The real fix is to regenerate the widget module from the shared source (see
 * #127), not to loosen this assertion.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { DEV_HUB_AUTH_TOKEN, resolveHubAuthToken } from '../../shared/hub-auth.js';
import { buildRuntimeConfig } from './runtime-config.js';

// The widget module sits next to this test; the shared source is two levels up.
const WIDGET_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime-config.js');

describe('widget / server hub auth token agreement', () => {
  it('resolves the same token as hubreceiver and the collector', () => {
    expect(buildRuntimeConfig({}).hubAuthToken).toBe(resolveHubAuthToken({}));
  });

  it('resolves the same token when the env var is empty', () => {
    expect(buildRuntimeConfig({ HUB_AUTH_TOKEN: '' }).hubAuthToken)
      .toBe(resolveHubAuthToken({ HUB_AUTH_TOKEN: '' }));
  });

  it('resolves the same literal the shared module exports', () => {
    // The widget repeats the literal rather than importing it, so compare the
    // module's own default against the exported constant for every input.
    for (const env of [{}, { HUB_AUTH_TOKEN: '' }, { HUB_AUTH_TOKEN: 'x' }]) {
      expect(buildRuntimeConfig(env).hubAuthToken).toBe(resolveHubAuthToken(env));
    }
    expect(DEV_HUB_AUTH_TOKEN).toBe('dev-secret');
  });

  it('keeps the widget source literal in step with the shared constant', () => {
    const source = fs.readFileSync(WIDGET_MODULE, 'utf-8');
    const declared = source.match(/const DEFAULT_HUB_AUTH_TOKEN\s*=\s*'([^']*)'/);
    expect(declared, 'runtime-config.js must declare DEFAULT_HUB_AUTH_TOKEN').not.toBeNull();
    expect(declared ? declared[1] : null).toBe(DEV_HUB_AUTH_TOKEN);
  });
});
