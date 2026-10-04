/**
 * TEST-ONLY helpers for the adapter fixtures.
 *
 * Not a `.test.ts` file, so `tsconfig.json` typechecks it and `eslint` lints it,
 * and not reachable from any production import — nothing outside the fixtures
 * imports this module. It lives here rather than in `shared/` because it is a
 * test convenience with no production consumer.
 */
import type { AdapterSessionDetail, AgentAdapter, AgentSessionSummary } from '../../shared/types.js';

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

/**
 * `getSessionDetail` answers a union for the same reason, and the same rule
 * applies: a fixture pinning a reader's SUCCESS behaviour wants the detail, and
 * asserts rather than coerces. `result.detail ?? { toolHistory: [], messages: [] }`
 * would make a fixture that accidentally drove a FAILING reader compare against
 * the empty detail and pass for the wrong reason — the precise confusion this
 * contract exists to remove, re-introduced in the test suite.
 *
 * The legitimate "this session has nothing stored" answer is `ok: true` with
 * `{ toolHistory: [], messages: [] }`, so it comes through here unchanged; only
 * `ok: false` throws. Fixtures exercising a failing reader call
 * `getSessionDetail` directly and narrow on `ok`.
 */
export async function detailOf(
  adapter: AgentAdapter,
  sessionId: string,
  project: string | null = null,
  filePath?: string | null,
): Promise<AdapterSessionDetail> {
  // The optional argument is forwarded ONLY when one was given: passing an explicit
  // `undefined` changes the call's arity, which a mock assertion can see.
  const result = filePath === undefined
    ? await adapter.getSessionDetail(sessionId, project)
    : await adapter.getSessionDetail(sessionId, project, filePath);
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.detail;
}