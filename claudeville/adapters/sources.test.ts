/**
 * The shared rule, tested directly.
 *
 * Every adapter's answer goes through `combineSources` or `combineDetailSources`,
 * but nothing tested the rule ITSELF: each adapter's suite pins what its own
 * sources produce, and a bug in the shared combiner would have to reproduce
 * itself in every adapter to be caught. These cases drive the combiner with
 * hand-built sources, which is the only way to reach combinations no fixture
 * produces.
 *
 * The priority cases are the reason this file exists. `combineDetailSources`
 * answers with the FIRST source that answered, which was previously an
 * incidental property of the order a caller appended in — so a low-priority
 * source pushed first would silently win. The order is now a named `primary`
 * argument, and the first case below pins what that means: reversing the two
 * sources REVERSES which detail comes back.
 */
import { describe, expect, it } from 'vitest';

import type { AdapterSessionDetail, AdapterWarning } from '../../shared/types.js';

import { combineDetailSources, combineSources, degradedWarnings, emptyDetail, type DetailSource, type SourceListing } from './sources.js';

const detail = (text: string): AdapterSessionDetail => ({ toolHistory: [], messages: [{ text }] });

const answered = (text: string, warnings: AdapterWarning[] = []): DetailSource => ({
  kind: 'detail',
  detail: detail(text),
  warnings,
});

/**
 * The `failed` branch, structurally identical in `SourceListing` and
 * `DetailSource` — `combineSources` takes the first, `combineDetailSources` the
 * second, and one builder has to drive both. Declaring `failed` as the whole
 * `DetailSource` union made every listing case a TS2322, because the wider type
 * is not assignable to the narrower one even though its `failed` member is.
 */
type FailedSource = Extract<DetailSource, { kind: 'failed' }>;

const failed = (code: 'store-unreadable' | 'root-unreadable', message: string): FailedSource => ({ kind: 'failed', code, detail: message });

const textOf = (result: ReturnType<typeof combineDetailSources>): string | null => {
  if (!result.ok) return null;
  return result.detail.messages[0]?.text ?? null;
};

describe('combineDetailSources: the primary source outranks the fallbacks', () => {
  // The pin. Under the old positional rule these two calls were the same
  // function with the same array; now the priority is an argument, so a future
  // author cannot reverse the two halves by accident and cannot tell from the
  // type that they HAD been ordered.
  it('answers with primary, not with whichever source happens to come first', () => {
    const store = answered('from the store');
    const legacy = answered('from the legacy file');

    expect(textOf(combineDetailSources({ primary: store, fallbacks: [legacy] }))).toBe('from the store');
    expect(textOf(combineDetailSources({ primary: legacy, fallbacks: [store] }))).toBe('from the legacy file');
  });

  it('consults the fallbacks only when primary did not answer', () => {
    const legacy = answered('from the legacy file');

    expect(textOf(combineDetailSources({ primary: { kind: 'absent' }, fallbacks: [legacy] }))).toBe('from the legacy file');
    expect(textOf(combineDetailSources({ primary: { kind: 'absent' }, fallbacks: [{ kind: 'absent' }, legacy] }))).toBe('from the legacy file');
  });

  it('reports every source warning, losing side included', () => {
    // The loser degrades loudly rather than silently: a store that refused to
    // open beside a transcript that rendered is a warning on a detail that
    // stands, and dropping it would hide the loss.
    const result = combineDetailSources({
      primary: answered('from the legacy file', [{ code: 'unknown', detail: '1 message' }]),
      fallbacks: [failed('store-unreadable', 'state.db would not open')],
    });

    expect(result.ok).toBe(true);
    // `warnings` lives on the SUCCESS branch only, so the union has to be narrowed
    // before it is read — `expect(result.ok).toBe(true)` asserts at runtime but does
    // not narrow at compile time, which is why every other case in this file already
    // pairs the two.
    if (!result.ok) throw new Error('unreachable');
    expect(result.warnings).toStrictEqual([
      { code: 'unknown', detail: '1 message' },
      { code: 'store-unreadable', detail: 'state.db would not open' },
    ]);
  });

  it('is ok: false when a failure is the only thing any source has', () => {
    const result = combineDetailSources({ primary: { kind: 'absent' }, fallbacks: [failed('store-unreadable', 'state.db would not open')] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toStrictEqual({ code: 'store-unreadable', message: 'state.db would not open' });
  });

  it('answers the empty detail when every source is absent', () => {
    // The legitimate third outcome, not a failure: `absent` is "nothing stored
    // here", and it is the answer for most sessions of most providers.
    const result = combineDetailSources({ primary: { kind: 'absent' } });

    expect(result.ok).toBe(true);
    // Narrowed before `warnings` is read — see the first case in this describe.
    if (!result.ok) throw new Error('unreachable');
    expect(result.warnings).toStrictEqual([]);
    if (!result.ok) throw new Error('unreachable');
    expect(result.detail).toStrictEqual(emptyDetail());
  });

  it('defaults to no fallbacks, so a single answering source needs no array', () => {
    expect(textOf(combineDetailSources({ primary: answered('only source') }))).toBe('only source');
  });
});

describe('combineSources: every answering source contributes, in priority-free order', () => {
  const rows = (ids: string[]): SourceListing => ({
    kind: 'rows',
    sessions: ids.map((id) => ({ sessionId: id, provider: 'test', project: null })),
    warnings: [],
  });

  it('concatenates both answering sources rather than picking one', () => {
    // The listing has NO priority: `state.db` and the legacy files are two halves
    // of the same install, and a session in one but not the other still belongs
    // in the listing. This is why `combineSources` did not need the `primary`
    // argument `combineDetailSources` got.
    const result = combineSources([rows(['a']), rows(['b'])]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.sessions.map((s) => s.sessionId)).toStrictEqual(['a', 'b']);
  });

  it('is ok: false only when nothing answered and something failed', () => {
    const result = combineSources([rows(['a']), failed('store-unreadable', 'state.db would not open')]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.sessions.map((s) => s.sessionId)).toStrictEqual(['a']);
    // The failure is demoted to a warning rather than dropped: the provider WAS
    // read, so only part of it was lost.
    expect(result.warnings).toStrictEqual([{ code: 'store-unreadable', detail: 'state.db would not open' }]);
  });

  it('reports the first failure when nothing answered', () => {
    // Order IS load-bearing here — this is the one positional choice in
    // `combineSources` — so it is pinned rather than left to the array. The two
    // halves are independent, so neither is more the cause; the ADR says so and
    // names the ordering as first-seen for payload stability.
    const result = combineSources([
      { kind: 'absent' },
      failed('store-unreadable', 'state.db would not open'),
      failed('root-unreadable', 'sessions directory could not be listed'),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toStrictEqual({ code: 'store-unreadable', message: 'state.db would not open' });
  });

  it('treats zero rows from an answering source as an answer, not a failure', () => {
    const result = combineSources([rows([]), failed('store-unreadable', 'state.db would not open')]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.sessions).toStrictEqual([]);
    expect(result.warnings).toStrictEqual([{ code: 'store-unreadable', detail: 'state.db would not open' }]);
  });
});

describe('degradedWarnings', () => {
  it('says nothing at zero and names the unit above it', () => {
    expect(degradedWarnings(0, 'root-unreadable', '1 session')).toStrictEqual([]);
    expect(degradedWarnings(3, 'root-unreadable', 'session')).toStrictEqual([{ code: 'root-unreadable', detail: '3 session' }]);
  });
});