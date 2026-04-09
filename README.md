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
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-brightgreen)]()

[![Claude Code](https://img.shields.io/badge/Claude_Code-Supported-a78bfa?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex_CLI-Supported-4ade80?logo=openai&logoColor=white)](https://github.com/openai/codex)
[![Gemini CLI](https://img.shields.io/badge/Gemini_CLI-Supported-60a5fa?logo=google&logoColor=white)](https://github.com/google-gemini/gemini-cli)

<!-- <img src="assets/demo.gif" alt="ClaudeVille Demo" width="800" /> -->

</div>

---

## What is ClaudeVille?

ClaudeVille is a **universal dashboard** for AI coding agents. It visualizes sessions from **Claude Code**, **OpenAI Codex CLI**, **Google Gemini CLI**, **OpenClaw**, and **GitHub Copilot CLI**. Agents appear as pixel characters roaming an isometric village, or as real-time monitoring cards in dashboard mode.

Each CLI stores session logs locally. ClaudeVille can run as a legacy all-in-one app, or as a split stack where a collector on the source machine streams snapshots to a hubreceiver and the frontend connects remotely.

## Supported CLI Tools

| CLI | Data Source | Provider Badge |
|---|---|---|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `~/.claude/` | 🟣 Purple |
| [Codex CLI](https://github.com/openai/codex) | `~/.codex/` | 🟢 Green |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `~/.gemini/` | 🔵 Blue |
| OpenClaw | `~/.openclaw/` | 🟠 Orange |
| GitHub Copilot CLI | `~/.copilot/` | 🔵 Cyan |

> Only installed CLIs are detected. You don't need all three — ClaudeVille works with whichever ones you have.

## Features

- **World Mode** — Isometric pixel village where agents roam as characters with unique appearances
- **Dashboard Mode** — Real-time agent cards showing tool usage, messages, and activity
- **Multi-Provider** — Claude Code + Codex CLI + Gemini CLI + OpenClaw + Copilot CLI
- **Live Detection** — WebSocket + file watcher for instant session updates
- **Agent Team & Swarm** — Auto-detects Claude Code teams, swarms, and sub-agents
- **Project Grouping** — Agents grouped by project with color-coded sections
- **Multilingual** — Korean / English
- **Zero Dependencies** — Pure Node.js, no npm install needed

## Quick Start

```bash
git clone https://github.com/honorstudio/claude-ville.git
cd claude-ville
npm run dev
```

Open http://localhost:4000 in your browser. That's it.

### Split mode

In separate shells or machines:

```bash
npm run dev:hubreceiver
npm run dev:collector
npm run dev:frontend
```

Set `HUB_HTTP_URL` and `HUB_WS_URL` for the frontend if the hubreceiver runs on another host.

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
```

## Architecture

```
claude-ville/
├── claudeville/                # Legacy all-in-one app + frontend assets
│   ├── index.html
│   ├── server.js                # Node.js server (HTTP + WebSocket)
│   ├── adapters/                # Provider adapters
│   │   ├── index.js             #   Adapter registry
│   │   ├── claude.js            #   Claude Code adapter
│   │   ├── codex.js             #   Codex CLI adapter
│   │   └── gemini.js            #   Gemini CLI adapter
│   ├── services/                # Backend services
│   │   └── usageQuota.js        #   Account & usage data
│   ├── css/                     # Stylesheets
│   └── src/
│       ├── config/              # Theme, buildings, i18n, constants
│       ├── domain/              # Entities, value objects, events
│       ├── infrastructure/      # Data source, WebSocket client
│       ├── application/         # Managers, session watcher
│       └── presentation/        # UI renderers (world / dashboard)
├── collector/                   # Remote file watcher + snapshot publisher
├── hubreceiver/                 # Snapshot ingestion + state/API server
├── frontend/                    # Static frontend host for remote browsers
├── widget/                      # macOS menu bar widget
│   ├── Sources/main.swift       #   Swift app (NSStatusItem + WKWebView)
│   ├── Resources/               #   HTML/CSS for popover UI
│   └── build.sh                 #   Build script
└── package.json
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript (ES Modules) |
| Rendering | Canvas 2D API (isometric pixel art) |
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

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

## License

[MIT](LICENSE)

---

<div align="center">

Made by **[honorstudio](https://github.com/honorstudio)**

</div>
