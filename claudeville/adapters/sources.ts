/**
 * The shared half of the typed error contract, hoisted out of `hermes.ts`.
 *
 * Every adapter reads its provider from one or more INDEPENDENT sources — a
 * database, a session directory, the legacy files behind that database — and the
 * classification rule is the same question for all nine of them: did anything
 * answer?
 *
 * Hoisted rather than copied per adapter, which is what `hermes.ts` said to do
 * ("the second adapter to need it hoists it into a shared `adapters/` module —
 * do not copy it a ninth time") when it was the only consumer. One definition of
 * the rule is the point: eight private copies would drift, and a drifted rule is
 * how a per-item degradation turns back into a whole-adapter failure.
 */
import path from 'path';

import type {
  AdapterErrorCode,
  AdapterSessionsResult,
  AdapterWarning,
  AgentSessionSummary,
} from '../../shared/types.js';

/**
 * One read source of a listing. Three states, and the third is the whole point:
 * `absent` is "nothing to read here", `rows` is "this source answered" (`[]`
 * included, because an empty answer is DATA — this install has no sessions), and
 * `failed` is "this source could not be read", carrying the code that says why.
 *
 * `rows` carries its own `warnings` for degradations INSIDE the source, which is
 * what keeps a per-session failure from ever reaching `failed`.
 */
export type SourceListing =
  | { kind: 'absent' }
  | { kind: 'rows'; sessions: AgentSessionSummary[]; warnings: AdapterWarning[] }
  | { kind: 'failed'; code: AdapterErrorCode; detail: string };

/**
 * The rule, in one place, because it is the thing every adapter has to get right:
 *
 * - a failure and NO source that answered ⇒ `ok: false`. The provider could not
 *   be read at all, so an empty listing would be a lie about an install that has
 *   sessions in it.
 * - anything else ⇒ `ok: true`, and every failure becomes a `warning`. A source
 *   that answered, even with zero rows, means the provider WAS read.
 *
 * The asymmetry is deliberate. `ok: false` over one bad record is the regression
 * this contract exists to prevent (`#156`, `#157`), so an adapter that cannot
 * classify a failure belongs here rather than in `error`.
 *
 * When two sources both fail, the first one is reported. They are independent
 * halves of the same install, so neither is more the cause than the other, and
 * the other is not silently dropped: it is still a `warning` — except in the
 * `ok: false` case, where the `AdapterError` has one `message` and a second code
 * would need a second channel this contract does not define. Adapters whose two
 * halves fail for *related* reasons (hermes' unreadable root) report one code
 * anyway, so nothing in practice is lost.
 */
export function combineSources(sources: SourceListing[]): AdapterSessionsResult {
  const failures = sources.filter((source): source is Extract<SourceListing, { kind: 'failed' }> => source.kind === 'failed');
  const answered = sources.some((source) => source.kind === 'rows');
  const warnings = sources.flatMap<AdapterWarning>((source) => {
    if (source.kind === 'rows') return source.warnings;
    if (source.kind === 'failed') return [{ code: source.code, detail: source.detail }];
    return [];
  });

  if (failures.length > 0 && !answered) {
    const { code, detail: message } = failures[0];
    return { ok: false, error: { code, message } };
  }
  return {
    ok: true,
    sessions: sources.flatMap((source) => (source.kind === 'rows' ? source.sessions : [])),
    warnings,
  };
}

/**
 * Operator-facing detail, and deliberately free of absolute paths: every adapter's
 * base directory contains a username, and this string reaches a log and, since
 * the diagnostics were wired into the WS frame and the REST payload, a UI. The
 * directory's own BASENAME is enough to tell two installs apart.
 */
export function sourceDetail(what: string, baseDir: string): string {
  return `${what} (${path.basename(baseDir)})`;
}

/**
 * The warning for "N of the provider's records were skipped", and NO warning at
 * zero — so a clean run reports nothing and the empty case costs one comparison.
 *
 * `unit` is what was skipped (`1 session`, `2 agent`, `3 project directory`), which
 * is the operator's only clue about the scale of the loss.
 */
export function degradedWarnings(count: number, code: AdapterErrorCode, unit: string): AdapterWarning[] {
  return count > 0 ? [{ code, detail: `${count} ${unit}` }] : [];
}