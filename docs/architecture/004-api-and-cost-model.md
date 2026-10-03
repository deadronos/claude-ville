# ADR 004: API ownership and cost / token presentation

## Status

Accepted

## Context

The session contract carries token counts, activity, and an estimated cost, and the UI presents them here:

- the activity panel

In practice the activity panel is the only surface that renders cost and token
figures today. The top bar shows only working / idle / waiting counts,
dashboard cards show no token or cost values, and the macOS widget
(`widget/Resources/popover.html`) shows session counts only.

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

Centralize Claude cost estimation in `shared/cost.ts` (`estimateCost`) and have the domain world reuse that helper instead of maintaining separate formulas. `claudeville/src/config/costs.ts` is a one-line re-export that exists only to keep existing import paths working; UI surfaces format the `cost` value the domain `Agent` already computed (`Agent.ts`) rather than re-deriving it.

Treat the split hubreceiver as the canonical source for merged session detail data, while also keeping `/api/history` available in the legacy server for parity.

Keep the legacy server responsible for the local all-in-one APIs, while the split-stack browser should use the runtime-configured hub URL for remote data access.

## Consequences

- the UI can render the same session data in multiple places without provider-specific branching
- cost calculations stay in one place — the activity panel today — so any surface that starts rendering cost reads the same domain value rather than its own formula
- the API contract becomes explicit enough to document and test
- call sites must use the correct base URL for their deployment mode
