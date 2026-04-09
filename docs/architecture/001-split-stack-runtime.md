# ADR 001: Split-stack runtime and shared runtime config

## Status

Accepted

## Context

ClaudeVille originally shipped as a single local Node process that read provider files directly and served the browser UI.

That works well for a local machine, but it does not solve the remote-browser case where the machine that owns the logs is different from the machine that opens the dashboard.

## Decision

Introduce a split-stack topology:

- `collector` runs close to the source machine and watches provider logs
- `hubreceiver` accepts snapshots and exposes the merged API / WebSocket surface
- `frontend` serves the static browser UI

Use `runtime-config.shared.js` to generate a consistent browser configuration payload for both legacy and split-stack environments.

Support `HUB_URL` as a convenience alias for `HUB_HTTP_URL` so existing setups can migrate without friction.

## Consequences

- ClaudeVille can be used locally or remotely with the same UI code.
- Runtime configuration is centralized and consistent across entrypoints.
- The system gains more moving parts, so documentation and validation matter more.
- Browser-side code must treat the configured runtime base URL as authoritative in split mode.
