# ADR 003: Stable identity, display-name pools, and project grouping

## Status

Accepted

## Context

Raw provider session IDs are often long, unstable, or unreadable in the UI.

At the same time, the dashboard needs to group sessions into meaningful project sections and keep team-related information visible.

## Decision

Use the naming pipeline in `claudeville/src/config/agentNames.js` to resolve readable names with these rules:

- prefer autodetected names when they already look human-friendly
- fall back to pooled short names when needed
- allow provider-specific mode overrides
- keep separate pools for agent/team names and session names

Preserve project metadata and use it for dashboard grouping, sidebar organization, and activity-panel context.

OpenClaw and Copilot adapters should expose stable identifiers that can survive repeated refreshes, while the UI remains focused on readable labels.

## Consequences

- the sidebar and dashboard are easier to scan
- provider-specific naming differences are hidden from the user
- the app can still preserve the underlying stable session identity for detail lookups
- group labels become more predictable across refreshes and WebSocket updates
