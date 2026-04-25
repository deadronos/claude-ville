# ClaudeVille Architecture

This folder documents the current architecture of ClaudeVille and the main decisions introduced since `upstream/main`.

## Documents

| File | Purpose |
| --- | --- |
| `000-overall-spec.md` | High-level architecture spec for the branch state after the split-stack and provider-expansion work. |
| `001-split-stack-runtime.md` | ADR for the collector / hubreceiver / frontend topology and runtime configuration model. |
| `002-provider-adapters.md` | ADR for the normalized multi-provider adapter contract. |
| `003-identity-and-grouping.md` | ADR for stable display names, provider-aware naming, and project grouping. |
| `004-api-and-cost-model.md` | ADR for API surface ownership, history parity, and cost/token presentation semantics. |
| `005-react-components.md` | React shell report covering component boundaries, state ownership, and layout rules. |
| `006-r3f-components.md` | R3F scene report covering camera behavior, scene transforms, and overlay rules. |

## Reading order

1. Start with the overall spec.
2. Read the ADRs in numeric order.
3. Read the React shell report before the R3F scene report.
4. Use the docs as the source of truth when changing architecture-sensitive code.
