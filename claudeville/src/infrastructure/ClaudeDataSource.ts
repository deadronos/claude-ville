import { getHubApiUrl } from '../config/runtime.js';

export class ClaudeDataSource {
    async getSessions() {
        try {
            const res = await fetch(getHubApiUrl('/api/sessions'));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.sessions || [];
        } catch (err) {
            console.error('[DataSource] Session query failed:', err.message);
            return [];
        }
    }

    async getTeams() {
        try {
            const res = await fetch(getHubApiUrl('/api/teams'));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.teams || [];
        } catch (err) {
            console.error('[DataSource] Team query failed:', err.message);
            return [];
        }
    }

    async getTasks() {
        try {
            const res = await fetch(getHubApiUrl('/api/tasks'));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.taskGroups || [];
        } catch (err) {
            console.error('[DataSource] Task query failed:', err.message);
            return [];
        }
    }

    async getUsage() {
        try {
            const res = await fetch(getHubApiUrl('/api/usage'));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.error('[DataSource] Usage query failed:', err.message);
            return null;
        }
    }

    async getHistory(lines = 100) {
        try {
            const res = await fetch(getHubApiUrl('/api/history', { lines }));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.entries || [];
        } catch (err) {
            console.error('[DataSource] History query failed:', err.message);
            return [];
        }
    }
}
