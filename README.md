<div align="center">

```
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝
       ██╗   ██╗██╗██╗     ██╗     ███████╗
       ██║   ██║██║██║     ██║     ██╔════╝
       ╚██╗ ██╔╝██║██║     ██║     █████╗
        ╚████╔╝ ██║██║     ██║     ██╔══╝
         ╚██╔╝  ██║███████╗███████╗███████╗
          ╚═╝   ╚═╝╚══════╝╚══════╝╚══════╝
```

**Universal AI Coding Agent Visualization Dashboard**

Watch your AI agent teams come alive in an isometric pixel world

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Frontend](https://img.shields.io/badge/Frontend-React%20%2B%20R3F-61dafb)]()

[![Claude Code](https://img.shields.io/badge/Claude_Code-Supported-a78bfa?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex_CLI-Supported-4ade80?logo=openai&logoColor=white)](https://github.com/openai/codex)
[![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-Supported-60a5fa?logo=google&logoColor=white)](https://github.com/google-gemini/gemini-cli)

<!-- <img src="assets/demo.gif" alt="ClaudeVille Demo" width="800" /> -->

</div>

---

## What is ClaudeVille?

ClaudeVille is a **universal dashboard** for AI coding agents. It visualizes sessions from **Claude Code**, **OpenAI Codex CLI**, **Google Gemini CLI**, **OpenClaw**, **GitHub Copilot CLI**, and **VS Code / VS Code Insiders Copilot Chat** debug sessions. Agents appear as pixel characters roaming an isometric village, or as real-time monitoring cards in dashboard mode.

Each CLI stores session logs locally. ClaudeVille can run as a legacy all-in-one app, or as a split stack where a collector on the source machine streams snapshots to a hubreceiver and the frontend connects remotely.

## Supported CLI Tools

| CLI | Data Source | Provider Badge |
|---|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `~/.claude/` | 🟣 Purple |
| [Codex CLI](https://github.com/openai/codex) | `~/.codex/` | 🟢 Green |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `~/.gemini/` | 🔵 Blue |
| OpenClaw | `~/.openclaw/` | 🟠 Orange |
| GitHub Copilot CLI | `~/.copilot/` | 🔵 Cyan |
| VS Code / VS Code Insiders Copilot Chat | `~/Library/Application Support/Code*/User/workspaceStorage/.../GitHub.copilot-chat/debug-logs/.../main.jsonl` | 🩵 Light Blue |

> The VS Code / Insiders adapter uses provider key `vscode` (shared for stable UI grouping). Session IDs are namespaced as `vscode:<channel>:<workspaceId>:<sessionId>`.

> Only installed CLIs are detected. You don't need all three — ClaudeVille works with whichever ones you have.

## Features

- **World Mode** — Isometric pixel village where agents roam as characters with unique appearances
- **Dashboard Mode** — Real-time agent cards showing tool usage, messages, and activity
- **Multi-Provider** — Claude Code + Codex CLI + Gemini CLI + OpenClaw + Copilot CLI + VS Code Copilot Chat logs
- **Live Detection** — WebSocket + file watcher for instant session updates
- **Agent Team & Swarm** — Auto-detects Claude Code teams, swarms, and sub-agents
- **Project Grouping** — Agents grouped by project with color-coded sections
- **English-only UI** — Consistent English labels across the app
- **React + React Three Fiber frontend** — Same isometric village, now powered by Vite, React, and WebGL rendering

## Quick Start

```bash
git clone https://github.com/honorstudio/claude-ville.git
cd claude-ville
npm run dev
```

Open http://localhost:3001 in your browser. The backend/API still listens on http://localhost:4000, and `npm run dev` now launches both the API server and the Vite frontend together.

### Production-ish frontend build

```bash
npm run build:frontend
npm run dev:server
```

After building, the legacy server will automatically serve `dist/frontend/` on port `4000`.

### Split mode

In separate shells or machines:

```bash
npm run dev:hubreceiver
npm run dev:collector
npm run dev:frontend
```

Each Node entrypoint auto-loads `.env.local` from the repo root if it exists.
Set `HUB_HTTP_URL` and `HUB_WS_URL` for the frontend if the hubreceiver runs on another host.
`HUB_URL` is also accepted by the frontend as a shortcut for `HUB_HTTP_URL`.
The browser app uses the configured hub HTTP base for session, detail, usage, and history requests in split mode.

### Display name pools

When ClaudeVille sees a long raw session or agent identifier, it now shows a short stable display name instead. You can customize the generated names with `.env.local`:

```bash
# Default display mode: autodetected names or pooled random names
CLAUDEVILLE_NAME_MODE=autodetected

# Optional per-provider overrides
CLAUDEVILLE_NAME_MODE_CLAUDE=autodetected
CLAUDEVILLE_NAME_MODE_CODEX=autodetected
CLAUDEVILLE_NAME_MODE_GEMINI=autodetected
CLAUDEVILLE_NAME_MODE_OPENCLAW=autodetected
CLAUDEVILLE_NAME_MODE_COPILOT=autodetected

# Separate pools for agent/team names and session names
CLAUDEVILLE_AGENT_NAME_POOL=Atlas,Nova,Cipher,Pixel,Spark,Bolt,Echo,Flux,Helix,Onyx
CLAUDEVILLE_SESSION_NAME_POOL=Orbit,Beacon,Relay,Pulse,Signal,Vector,Comet,Drift,Trace,Kernel
```

The same variables are used by the legacy app, the split frontend, and the collector/hubreceiver runtime config they serve. If a session already has a human-friendly name, ClaudeVille keeps it in autodetected mode; pooled mode always uses the configured pool. Provider-specific overrides can force a mode for a given provider.

### macOS Menu Bar Widget (Optional)

A lightweight status bar widget that shows agent status at a glance.

```bash
cd widget
bash build.sh
open ClaudeVilleWidget.app
```

The widget:
- Shows working/idle agent count in the menu bar
- Displays agent list, token usage, and subscription info in a popover
- Auto-starts the ClaudeVille server if not running
- Click "Open Dashboard" to launch the full browser UI

> `build.sh` auto-detects your project path and Node.js location. No manual configuration needed.

## Requirements

- [Node.js](https://nodejs.org/) v18+
- At least one of:
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`~/.claude/`)
  - [Codex CLI](https://github.com/openai/codex) (`~/.codex/`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) (`~/.gemini/`)
- **Widget only**: macOS + Xcode Command Line Tools (`xcode-select --install`)

## How It Works

Each CLI stores session logs in its own directory. ClaudeVille uses an **adapter pattern** to normalize sessions from all providers into a unified format, then streams updates to your browser via WebSocket.

```
~/.claude/                          # Claude Code
├── history.jsonl
├── projects/{path}/{sessionId}/
│   └── subagents/
├── teams/
└── tasks/

~/.codex/                           # Codex CLI
└── sessions/YYYY/MM/DD/
    └── rollout-*.jsonl

~/.gemini/                          # Gemini CLI
└── tmp/{project_hash}/chats/
    └── session-*.json

~/Library/Application Support/Code/User/workspaceStorage/                   # VS Code
└── {workspaceId}/GitHub.copilot-chat/debug-logs/{sessionId}/main.jsonl

~/Library/Application Support/Code - Insiders/User/workspaceStorage/        # VS Code Insiders
└── {workspaceId}/GitHub.copilot-chat/debug-logs/{sessionId}/main.jsonl
```

### VS Code adapter behavior

- Provider key is `vscode` (shared for stable UI grouping across Code + Insiders).
- Session IDs are namespaced as `vscode:<channel>:<workspaceId>:<sessionId>`.
- Project path is resolved from each workspace storage folder's `workspace.json`.
- Optional path overrides:
  - `VSCODE_USER_DATA_DIR`
  - `VSCODE_INSIDERS_USER_DATA_DIR`

## Architecture

```
claude-ville/
├── claudeville/                # Legacy all-in-one app (serves UI + API)
│   ├── index.html              #   HTML shell
│   ├── server.js               #   Node.js server (HTTP + WebSocket)
│   ├── runtime-config.js      #   Runtime config loader
│   ├── adapters/              #   Provider adapters (CommonJS)
│   │   ├── index.js           #   Adapter registry
│   │   ├── claude.js          #   Claude Code adapter
│   │   ├── codex.js           #   Codex CLI adapter
│   │   ├── gemini.js          #   Gemini CLI adapter
│   │   ├── copilot.js         #   Copilot CLI adapter
│   │   ├── openclaw.js        #   OpenClaw adapter
│   │   └── vscode.js          #   VS Code / Insiders adapter
│   ├── services/              #   Backend services
│   │   └── usageQuota.js      #   Account & usage data
│   ├── css/                   #   Stylesheets
│   └── src/                   #   Application source (ES modules)
│       ├── config/            #   Theme, buildings, i18n, constants, costs
│       ├── domain/            #   Entities, value objects, events
│       ├── infrastructure/    #   Data source, WebSocket client
│       ├── application/        #   Managers, session watcher
│       └── presentation/       #   UI renderers (world / dashboard)
├── collector/                 #   Remote file watcher + snapshot publisher
├── hubreceiver/               #   Snapshot ingestion + state/API server
├── frontend/                  #   Static server for remote browser UI
│   └── server.js              #   Serves claudeville/ static files
├── widget/                    #   macOS menu bar widget
│   ├── Sources/main.swift     #   Swift app (NSStatusItem + WKWebView)
│   ├── Resources/             #   HTML/CSS for popover UI
│   └── build.sh               #   Build script
├── runtime-config.shared.js   #   Shared runtime config builder
└── package.json
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Rendering | React Three Fiber / Three.js (orthographic isometric pixel-art scene) |
| Server | Node.js built-in modules only |
| Real-time | WebSocket (RFC 6455, hand-rolled) |
| Data | Local CLI session files (read-only) |

## API

| Endpoint | Description |
|---|---|
| `GET /api/sessions` | Active sessions from all providers |
| `GET /api/session-detail?sessionId=&project=&provider=` | Tool history + messages |
| `GET /api/teams` | Claude Code team list |
| `GET /api/tasks` | Claude Code task list |
| `GET /api/providers` | Detected provider list |
| `GET /api/usage` | Account info, subscription tier, daily activity |
| `GET /api/history?lines=100` | Last N lines of Claude history |
| `ws://localhost:4000` | Real-time updates (WebSocket) |

### Android App (Optional)

A lightweight Android wrapper embeds the built frontend into a WebView and ships it as an APK. Requirements: Android Studio (recommended) or the Android SDK + command-line tools, JDK 11+, Android SDK platform 34 (compileSdk 34), minSdk 26.

Quick build (from the repository root):

```bash
# build the frontend and copy into Android assets
bash android/sync-assets.sh

# build debug APK and install on a connected device/emulator
cd android
./gradlew assembleDebug
./gradlew installDebug
```

Notes:
- Run `bash android/sync-assets.sh` from the repo root — it runs `npm run build:frontend` and copies `dist/frontend/` into `android/app/src/main/assets/www`.
- Open the `android/` project in Android Studio to run on emulators, inspect logs, or create a signed release (Build → Generate Signed Bundle / APK). Configure `signingConfigs` for release builds.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

[MIT](LICENSE)

---

<div align="center">

Made by **[honorstudio](https://github.com/honorstudio)**

</div>
