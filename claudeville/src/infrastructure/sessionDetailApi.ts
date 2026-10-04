import type { AdapterError, AdapterSessionDetail } from '../../../shared/types.js';

import { getHubApiUrl, getHubAuthHeaders } from '../config/runtime.js';

/**
 * The subset of AdapterSessionDetail the hub's /api/session-detail returns.
 * The hub normalises absent collections to [], but an older or partial hub may
 * omit them, so these stay defaulted rather than asserted.
 *
 * `error` is the new additive field: present only when the reader FAILED, which
 * used to arrive as a 200 with an empty detail and read as "this session has
 * nothing stored". It is carried through rather than swallowed so a caller can
 * tell those apart; nothing renders it yet, and `null` still covers every other
 * way this fetch can come back empty-handed.
 */
export type SessionDetailData = Pick<AdapterSessionDetail, 'toolHistory' | 'messages'> & {
  error?: AdapterError;
};

export async function fetchSessionDetail(
  sessionId: string,
  project = '',
  provider = 'claude',
): Promise<SessionDetailData | null> {
  try {
    const url = getHubApiUrl('/api/session-detail', { sessionId, project, provider });
    const headers = getHubAuthHeaders();
    const response = headers ? await fetch(url, { headers }) : await fetch(url);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return {
      toolHistory: data.toolHistory || [],
      messages: data.messages || [],
      ...(data.error ? { error: data.error as AdapterError } : {}),
    };
  } catch {
    return null;
  }
}
