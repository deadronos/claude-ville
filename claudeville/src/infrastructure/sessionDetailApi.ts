import type { AdapterSessionDetail } from '../../../shared/types.js';

import { getHubApiUrl, getHubAuthHeaders } from '../config/runtime.js';

/**
 * The subset of AdapterSessionDetail the hub's /api/session-detail returns.
 * The hub normalises absent collections to [], but an older or partial hub may
 * omit them, so these stay defaulted rather than asserted.
 */
export type SessionDetailData = Pick<AdapterSessionDetail, 'toolHistory' | 'messages'>;

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
    };
  } catch {
    return null;
  }
}
