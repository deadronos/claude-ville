# Agent Guidelines for ClaudeVille

This directory contains agent-specific skills and learnings for the ClaudeVille project.

## Agent Skills

Skills are loaded from `.agents/skills/`. 

### Self-Improvement Skill

See `.agents/skills/self-improvement/` for the self-improvement skill that captures learnings during development.

**When to use:**
- A command or operation fails unexpectedly
- User corrects you ("No, that's wrong...", "Actually...")
- User requests a capability that doesn't exist
- You discover a better approach for a recurring task
- You realize knowledge is outdated or incorrect

**How to use:**
After non-obvious fixes or corrections, log to `.agents/.learnings/` using the format in the self-improvement skill.

## Learnings

Captured learnings live in `.agents/.learnings/`:
- `LEARNINGS.md` — corrections, insights, knowledge gaps, best practices
- `ERRORS.md` — command failures, exceptions
- `FEATURE_REQUESTS.md` — user-requested capabilities

## Promoting Learnings

When learnings prove broadly applicable, promote them to:
- `CLAUDE.md` — Project facts and conventions
- `.github/copilot-instructions.md` — Project context for GitHub Copilot
- `docs/architecture/` — Architectural decisions and patterns

See `.agents/skills/self-improvement/SKILL.md` for full format and promotion guidelines.
