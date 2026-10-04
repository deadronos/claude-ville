/**
 * TEST-ONLY helpers for the adapter fixtures.
 *
 * Not a `.test.ts` file, so `tsconfig.json` typechecks it and `eslint` lints it,
 * and not reachable from any production import — nothing outside the fixtures
 * imports this module. It lives here rather than in `shared/` because it is a
 * test convenience with no production consumer.
 */
import type { AgentAdapter, AgentSessionSummary } from '../../shared/types.js';

/**
 * `getActiveSessions` answers a union, and a fixture that is pinning an adapter's
 * SUCCESS behaviour wants the sessions. This asserts rather than coerces: a
 * fixture whose adapter reports a whole-adapter failure throws here and the test
 * fails loudly, instead of comparing against `[]` and passing for the wrong
 * reason. That is the failure mode a bare `result.sessions ?? []` would hide —
 * and it is why the fixtures do NOT unwrap the union themselves: 250-odd call
 * sites each hand-rolling a narrowing is how a fixture starts asserting a
 * fallback shape instead of the adapter's real answer.
 *
 * Fixtures that exercise a FAILING adapter must NOT use this. Those call
 * `getActiveSessions` directly and narrow on `ok`, because the error branch is
 * the thing under test.
 */
export async function sessionsOf(adapter: AgentAdapter, activeThresholdMs: number): Promise<AgentSessionSummary[]> {
  const result = await adapter.getActiveSessions(activeThresholdMs);
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.sessions;
}