# ClaudeVille Agent Instructions

Primary repository guidance lives in [`.github/copilot-instructions.md`](./.github/copilot-instructions.md).

## Agent Skills & Learnings

See [`.agents/AGENTS.md`](.agents/AGENTS.md) for agent-specific skills and learnings. The `.agents/` folder contains:
- `.agents/skills/` — reusable skills (e.g., self-improvement for capturing learnings)
- `.agents/.learnings/` — captured learnings during development

## Pull Requests

When creating PRs, **open them against your fork's `origin/main` by default**, not the upstream repository. Only open PRs upstream when explicitly requested or when contributing a finished feature back to the main project. This avoids spamming the upstream maintainers with work-in-progress or fork-specific changes.

## Self-Improvement
Agents should have a self-improvment loop to capture learnings and errors after each non-obvious fix or correction. Use the self-improvement skill in `.agents/skills/self-improvement/` to log to markdown files in `.agents/.learnings/`.