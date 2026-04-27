---
name: self-improvement
description: "Captures learnings, errors, and corrections for continuous improvement. Use when: (1) A command fails unexpectedly, (2) User corrects you, (3) User requests a missing capability, (4) An external API or tool fails, (5) You discover knowledge is outdated, (6) A better approach is found for a recurring task. Works with any AI coding agent."
---

# Self-Improvement Skill

Log learnings and errors to markdown files for continuous improvement. Any AI coding agent can use this skill — it captures project-specific knowledge that improves over time.

## Quick Reference

| Situation | Action |
|-----------|--------|
| Command/operation fails | Log to `.agents/.learnings/ERRORS.md` |
| User corrects you | Log to `.agents/.learnings/LEARNINGS.md` with category `correction` |
| User wants missing feature | Log to `.agents/.learnings/FEATURE_REQUESTS.md` |
| API/external tool fails | Log to `.agents/.learnings/ERRORS.md` with integration details |
| Knowledge was outdated | Log to `.agents/.learnings/LEARNINGS.md` with category `knowledge_gap` |
| Found better approach | Log to `.agents/.learnings/LEARNINGS.md` with category `best_practice` |
| Similar to existing entry | Link with `**See Also**`, consider priority bump |
| Broadly applicable learning | Promote to `CLAUDE.md`, `AGENTS.md`, or `.github/copilot-instructions.md` |

## Setup

**No installation required** — the skill is already in `.agents/skills/self-improvement/`. Just use the logging format below.

**Learning files location**: `.agents/.learnings/`
- `LEARNINGS.md` — corrections, insights, knowledge gaps, best practices
- `ERRORS.md` — command failures, exceptions
- `FEATURE_REQUESTS.md` — user-requested capabilities

## Logging Format

### Learning Entry

Append to `.agents/.learnings/LEARNINGS.md`:

```markdown
## [LRN-YYYYMMDD-XXX] category

**Logged**: ISO-8601 timestamp
**Priority**: low | medium | high | critical
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Summary
One-line description of what was learned

### Details
Full context: what happened, what was wrong, what's correct

### Suggested Action
Specific fix or improvement to make

### Metadata
- Source: conversation | error | user_feedback
- Related Files: path/to/file.ext
- Tags: tag1, tag2
- See Also: LRN-20250110-001 (if related to existing entry)

---
```

### Error Entry

Append to `.agents/.learnings/ERRORS.md`:

```markdown
## [ERR-YYYYMMDD-XXX] skill_or_command_name

**Logged**: ISO-8601 timestamp
**Priority**: high
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Summary
Brief description of what failed

### Error
```
Actual error message or output
```

### Context
- Command/operation attempted
- Input or parameters used
- Environment details if relevant

### Suggested Fix
If identifiable, what might resolve this

### Metadata
- Reproducible: yes | no | unknown
- Related Files: path/to/file.ext
- See Also: ERR-20250110-001 (if recurring)

---
```

### Feature Request Entry

Append to `.agents/.learnings/FEATURE_REQUESTS.md`:

```markdown
## [FEAT-YYYYMMDD-XXX] capability_name

**Logged**: ISO-8601 timestamp
**Priority**: medium
**Status**: pending
**Area**: frontend | backend | infra | tests | docs | config

### Requested Capability
What the user wanted to do

### User Context
Why they needed it, what problem they're solving

### Complexity Estimate
simple | medium | complex

### Suggested Implementation
How this could be built, what it might extend

### Metadata
- Frequency: first_time | recurring
- Related Features: existing_feature_name

---
```

## ID Generation

Format: `TYPE-YYYYMMDD-XXX`
- TYPE: `LRN` (learning), `ERR` (error), `FEAT` (feature)
- YYYYMMDD: Current date
- XXX: Sequential number or random 3 chars (e.g., `001`, `A7B`)

## Resolving Entries

When an issue is fixed, update the entry:

1. Change `**Status**: pending` → `**Status**: resolved`
2. Add resolution block:

```markdown
### Resolution
- **Resolved**: 2025-01-16T09:00:00Z
- **Commit/PR**: abc123 or #42
- **Notes**: Brief description of what was done
```

Other statuses:
- `in_progress` — actively being worked on
- `wont_fix` — decided not to address
- `promoted` — elevated to CLAUDE.md or AGENTS.md

## Promoting to Project Memory

When a learning is broadly applicable, promote it to permanent project documentation.

| Learning Type | Promote To |
|---------------|-----------|
| Project facts/conventions | `CLAUDE.md` |
| Agent workflows/patterns | `AGENTS.md` |
| Project-specific context | `.github/copilot-instructions.md` |

**How to promote:**
1. Distill the learning into a concise rule
2. Add to appropriate section
3. Update original entry status to `promoted`

## Detection Triggers

Log automatically when you notice:

**Corrections** (→ learning with `correction`):
- "No, that's not right..."
- "Actually, it should be..."
- "You're wrong about..."

**Feature Requests** (→ feature request):
- "Can you also..."
- "I wish you could..."
- "Why can't you..."

**Knowledge Gaps** (→ learning with `knowledge_gap`):
- User provides info you didn't know
- Documentation is outdated

**Errors** (→ error entry):
- Command returns non-zero
- Exception or stack trace
- Unexpected behavior

## Priority Guidelines

| Priority | When to Use |
|----------|-------------|
| `critical` | Blocks core functionality, data loss, security |
| `high` | Significant impact on common workflows |
| `medium` | Moderate impact, workaround exists |
| `low` | Minor inconvenience, edge case |

## Area Tags

| Area | Scope |
|------|-------|
| `frontend` | UI, components, client-side |
| `backend` | API, services, server-side |
| `infra` | CI/CD, deployment, Docker |
| `tests` | Test files, coverage |
| `docs` | Documentation |
| `config` | Configuration files |

## Best Practices

1. **Log immediately** — context is freshest right after the issue
2. **Be specific** — future agents need to understand quickly
3. **Include reproduction steps** — especially for errors
4. **Link related files** — makes fixes easier
5. **Suggest concrete fixes** — not just "investigate"
6. **Promote aggressively** — if in doubt, add to CLAUDE.md

## Recurring Pattern Detection

Before logging, check for similar entries:
```bash
grep -r "keyword" .agents/.learnings/
```

If similar entries exist:
1. Link with `**See Also**`
2. Bump priority if recurring
3. Consider systemic fix

## Gitignore

**Keep learnings local** (per-developer):
```gitignore
.agents/.learnings/
```

**Track in repo** (team-wide):
Don't add to .gitignore — learnings become shared knowledge.
