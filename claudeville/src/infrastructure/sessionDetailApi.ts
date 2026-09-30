import { getHubApiUrl, getHubAuthHeaders } from '../config/runtime.js';

export type SessionDetailData = {
  toolHistory: any[];
  messages: any[];
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
    };
  } catch {
    return null;
  }
}
