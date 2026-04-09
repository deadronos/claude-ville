# ADR 004: API ownership and cost / token presentation

## Status

Accepted

## Context

The UI presents token counts, activity, and estimated costs in multiple places:

- the top bar
- the activity panel
- dashboard cards
- the macOS widget

To remain trustworthy, these values need a clear ownership model and compatible data shape across all renderers.

The branch also restored `/api/history` on the legacy server so the local all-in-one mode matches the split hubreceiver API shape.

## Decision

Define a shared session contract that includes:

- `tokens`
- `tokenUsage`
- `estimatedCost`
- `lastMessage`
- `lastTool`
- `lastToolInput`

Centralize Claude cost estimation in `claudeville/src/config/costs.js` and have the domain world plus UI surfaces reuse that helper instead of maintaining separate formulas.

Treat the split hubreceiver as the canonical source for merged session detail data, while also keeping `/api/history` available in the legacy server for parity.

Keep the legacy server responsible for the local all-in-one APIs, while the split-stack browser should use the runtime-configured hub URL for remote data access.

## Consequences

- the UI can render the same session data in multiple places without provider-specific branching
- cost calculations remain comparable across dashboard, widget, and activity views
- the API contract becomes explicit enough to document and test
- call sites must use the correct base URL for their deployment mode
