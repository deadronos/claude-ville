export const CLAUDE_RATE_TABLE = {
    'claude-opus-4-6': { input: 15, output: 75 },
    'claude-sonnet-4-5': { input: 3, output: 15 },
    'claude-haiku-4-5': { input: 0.8, output: 4 },
};

export function estimateClaudeCost(model, tokens = { input: 0, output: 0 }) {
    const rate = CLAUDE_RATE_TABLE[model] || CLAUDE_RATE_TABLE['claude-sonnet-4-5'];
    const input = Number(tokens?.input || 0);
    const output = Number(tokens?.output || 0);
    return ((input * rate.input) + (output * rate.output)) / 1000000;
}