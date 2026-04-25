import { getHubApiUrl } from '../config/runtime.js';

export class ClaudeDataSource {
    async getSessions() {
        try {
            const res = await fetch(getHubApiUrl('/api/sessions'), { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.sessions || [];
        } catch (err: unknown) {
            console.error('[DataSource] Session query failed:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }

    async getTeams() {
        try {
            const res = await fetch(getHubApiUrl('/api/teams'), { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.teams || [];
        } catch (err: unknown) {
            console.error('[DataSource] Team query failed:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }

    async getTasks() {
        try {
            const res = await fetch(getHubApiUrl('/api/tasks'), { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.taskGroups || [];
        } catch (err: unknown) {
            console.error('[DataSource] Task query failed:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }

    async getUsage() {
        try {
            const res = await fetch(getHubApiUrl('/api/usage'), { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err: unknown) {
            console.error('[DataSource] Usage query failed:', err instanceof Error ? err.message : String(err));
            return null;
        }
    }

    async getHistory(lines = 100) {
        try {
            const res = await fetch(getHubApiUrl('/api/history', { lines }), { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.entries || [];
        } catch (err: unknown) {
            console.error('[DataSource] History query failed:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }
}
