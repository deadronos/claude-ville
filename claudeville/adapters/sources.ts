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
  AdapterDetailResult,
  AdapterErrorCode,
  AdapterSessionDetail,
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

// ─── The same rule, for ONE session's detail ───────────────

/**
 * One read source of a single session's detail. {@link SourceListing} with
 * `AdapterSessionDetail` in place of `AgentSessionSummary[]`, because it is the
 * same question asked of the same install at a different granularity: did
 * anything answer?
 *
 * `absent` is "this source has nothing for this session", which is the answer for
 * most sessions of most providers and is emphatically NOT a failure — turning it
 * into one would make every not-yet-selected session an error.
 *
 * This type is deliberately NOT ordered: the priority between two answering
 * sources is a named argument of {@link combineDetailSources}, not a property
 * of the array a caller passes, so it cannot be got wrong by pushing in the
 * wrong order.
 */
export type DetailSource =
  | { kind: 'absent' }
  | { kind: 'detail'; detail: AdapterSessionDetail; warnings: AdapterWarning[] }
  | { kind: 'failed'; code: AdapterErrorCode; detail: string };

/** The answering variant, named because it is the one `primary` has to hold. */
export type AnsweredDetailSource = Extract<DetailSource, { kind: 'detail' }>;

/** The failing variant, named because it is what the fallbacks mostly carry. */
export type FailedDetailSource = Extract<DetailSource, { kind: 'failed' }>;

/**
 * {@link combineSources}' rule, verbatim, with the detail record type. A failure
 * with NO source that answered is `ok: false` — for a detail that means "the only
 * store that could have held this session could not be read", which is the honest
 * answer. A failure alongside a source that DID answer is a `warning`: hermes'
 * `state.db` refusing to open does not stop its legacy transcript files from
 * rendering, so the detail stands and says what was lost.
 *
 * ## Why priority is a NAMED argument and not array position
 *
 * This used to be `sources.find((source) => source.kind === 'detail')` over a
 * flat array, which made "first answering source wins" an INCIDENTAL property
 * of the order a caller happened to push in. Push a low-priority source first
 * and it silently wins: the store's real detail is dropped and nothing fails.
 * Two independent halves of one install disagreeing about a session is exactly
 * the kind of silent-wrong-answer this contract exists to rule out.
 *
 * So the priority is now a STRUCTURAL argument. There is exactly one
 * {@link AnsweredDetailSource} slot, named `primary`, and a caller that means
 * "the store outranks the legacy files" has to say so where it is visible —
 * it cannot be expressed by accident. `fallbacks` are consulted only in order,
 * and only when `primary` did not answer.
 *
 * Both current callers already had the right answer under the old rule: hermes
 * puts its `state.db` half in `fallbacks` (it never holds an answered source,
 * since a readable store returns earlier via `detailOk`) and its legacy
 * transcript in `primary`; openclaw puts the agent database's failure in
 * `fallbacks` and the legacy JSONL in `primary`. What the restructure buys is
 * that the NEXT source cannot be added in the wrong place.
 *
 * Every source's warnings are reported, in `primary`-then-`fallbacks` order, so
 * nothing is lost to the selection — the losing side degrades loudly instead.
 *
 * An adapter with a single source does not need this: `detailOk` and
 * `detailFailed` are the two outcomes, and `emptyDetail` is the third.
 */
export function combineDetailSources(sources: {
  /** The source whose detail wins if it answers. `{ kind: 'absent' }` = nothing has it. */
  primary: DetailSource;
  /** Lower-priority sources, consulted in order only when `primary` did not answer. */
  fallbacks?: readonly DetailSource[];
}): AdapterDetailResult {
  const { primary, fallbacks = [] } = sources;
  const ordered = [primary, ...fallbacks];
  const answered = ordered.find((source): source is AnsweredDetailSource => source.kind === 'detail');
  const failures = ordered.filter((source): source is FailedDetailSource => source.kind === 'failed');
  const warnings = ordered.flatMap<AdapterWarning>((source) => {
    if (source.kind === 'detail') return source.warnings;
    if (source.kind === 'failed') return [{ code: source.code, detail: source.detail }];
    return [];
  });

  if (answered) return { ok: true, detail: answered.detail, warnings };
  if (failures.length > 0) {
    const { code, detail: message } = failures[0];
    return { ok: false, error: { code, message } };
  }
  // Every source was `absent`: this session has no stored detail anywhere, which
  // is the legitimate third outcome, not a failure.
  return { ok: true, detail: emptyDetail(), warnings };
}

/**
 * The detail a reader produced. `warnings` rides with it, because a degradation
 * inside one session's detail is still only a degradation — it costs that session
 * a row or a token reading, not the provider its sessions.
 */
export function detailOk(detail: AdapterSessionDetail, warnings: AdapterWarning[] = []): AdapterDetailResult {
  return { ok: true, detail, warnings };
}

/** A reader that failed. Never used for "this session has no stored detail". */
export function detailFailed(code: AdapterErrorCode, detail: string): AdapterDetailResult {
  return { ok: false, error: { code, message: detail } };
}

/**
 * The empty detail, as SUCCESS. The shape every "nothing stored here" answer
 * converges on, kept in one place because the guarantee it encodes is
 * contractual: `toolHistory` and `messages` are always arrays, never
 * `null`/`undefined`, so a caller that renders a detail never has to guard.
 */
export function emptyDetail(): AdapterSessionDetail {
  return { toolHistory: [], messages: [] };
}