import { World } from '../domain/entities/World.js';
import { Agent } from '../domain/entities/Agent.js';
import { Building } from '../domain/entities/Building.js';
import { BUILDING_DEFS } from '../config/buildings.js';
import { ClaudeDataSource } from '../infrastructure/ClaudeDataSource.js';
import { WebSocketClient } from '../infrastructure/WebSocketClient.js';

import { AgentManager } from '../application/AgentManager.js';
import { ModeManager } from '../application/ModeManager.js';
import { SessionWatcher } from '../application/SessionWatcher.js';
import { NotificationService } from '../application/NotificationService.js';
import { getNameMode, setNameMode } from '../config/agentNames.js';
import { getBubbleConfig as getBubble, updateBubbleConfig } from '../config/bubbleConfig.js';
import {
  TEXT_SIZE_PRESETS,
  getTextSizePresetKey,
} from "./shared/textSizePresets.js";

import { TopBar } from "./shared/TopBar.js";
import { Sidebar } from "./shared/Sidebar.js";
import { Toast } from "./shared/Toast.js";
import { Modal } from "./shared/Modal.js";
import { ActivityPanel } from "./shared/ActivityPanel.js";

export class App {
    world: World | null;
    dataSource: ClaudeDataSource | null;
    wsClient: WebSocketClient | null;
    agentManager: AgentManager | null;
    modeManager: ModeManager | null;
    sessionWatcher: SessionWatcher | null;
    notificationService: NotificationService | null;
    topBar: TopBar | null;
    sidebar: Sidebar | null;
    toast: Toast | null;
    modal: Modal | null;
    renderer: any;
    dashboardRenderer: any;
    activityPanel: ActivityPanel | null;
    _resizeObserver: ResizeObserver | null;

    constructor() {
        this.world = null;
        this.dataSource = null;
        this.wsClient = null;
        this.agentManager = null;
        this.modeManager = null;
        this.sessionWatcher = null;
        this.notificationService = null;
        this.topBar = null;
        this.sidebar = null;
        this.toast = null;
        this.modal = null;
        this.renderer = null;
        this.dashboardRenderer = null;
        this.activityPanel = null;
        this._resizeObserver = null;
    }

    async boot() {
        try {
            console.log("[App] ClaudeVille booting...");

            this.world = new World();
            for (const def of BUILDING_DEFS) {
                this.world.addBuilding(new Building(def));
            }

            this.dataSource = new ClaudeDataSource();
            this.wsClient = new WebSocketClient();

            this.toast = new Toast();
            this.modal = new Modal();
            this.topBar = new TopBar(this.world);
            this.sidebar = new Sidebar(this.world);

            this.agentManager = new AgentManager(this.world, this.dataSource);
            this.modeManager = new ModeManager();
            this.notificationService = new NotificationService(this.toast);

            await this.agentManager.loadInitialData();

            this.dataSource.getUsage().then((usage: any) => {
                if (usage) eventBus.emit("usage:updated", usage);
            });

            this.sessionWatcher = new SessionWatcher(
                this.agentManager,
                this.wsClient,
                this.dataSource,
            );
            this.sessionWatcher.start();

            this._bindResize();

            await this._loadRenderer();

            await this._loadDashboard();

            this.activityPanel = new ActivityPanel();
            this._bindAgentFollow();

            this._bindSettings();

            this._applyI18n();
        } catch (err) {
            console.error("[App] Boot failed:", err);
            this._showBootError(err as Error);
        }
    }

    async _loadRenderer() {
        try {
            const module = await import("./character-mode/IsometricRenderer.js");
            const canvas = document.getElementById("worldCanvas") as HTMLCanvasElement;

            if (module.IsometricRenderer && canvas && this.world) {
                this.renderer = new module.IsometricRenderer(this.world);
                this.renderer.show(canvas);
                if (this.renderer.camera) {
                    this.renderer.camera.centerOnMap();
                }
                this.renderer.onAgentSelect = ((agent: Agent | null) => {
                    if (agent) eventBus.emit("agent:selected", agent);
                }) as (agent: unknown) => void;
                console.log("[App] IsometricRenderer loaded");
            }
        } catch (err: any) {
            console.warn(
                "[App] IsometricRenderer not yet available (waiting for canvas-artist):",
                err.message,
            );
        }
    }

    async _loadDashboard() {
        try {
            const module = await import("./dashboard-mode/DashboardRenderer.js");
            if (module.DashboardRenderer && this.world) {
                this.dashboardRenderer = new module.DashboardRenderer(this.world);
                console.log("[App] DashboardRenderer loaded");
            }
        } catch (err: any) {
            console.warn("[App] DashboardRenderer load failed:", err.message);
        }
    }

    _bindAgentFollow() {
        eventBus.on("agent:selected", ((agent: Agent | null) => {
            if (agent && this.renderer) {
                this.renderer.selectAgentById(agent.id);
            }
        }) as (data?: unknown) => void);

        eventBus.on("agent:deselected", (() => {
            if (this.renderer) {
                this.renderer.selectAgentById(null);
            }
        }) as (data?: unknown) => void);
    }

    _bindResize() {
        const canvas = document.getElementById("worldCanvas") as HTMLCanvasElement;
        const container = canvas?.parentElement;
        if (!canvas || !container) return;

        const resize = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            if (w === 0 || h === 0) return;
            if (canvas.width === w && canvas.height === h) return;
            canvas.width = w;
            canvas.height = h;
            if (this.renderer && this.renderer.camera) {
                this.renderer.camera.centerOnMap();
            }
        };

        this._resizeObserver = new ResizeObserver(() => resize());
        this._resizeObserver.observe(container);

        window.addEventListener("resize", resize);
        resize();
    }

    _bindSettings() {
        const btn = document.getElementById("btnSettings");
        if (!btn) return;

        const sizeLabel = (preset: { key: string; labelKey: string }) =>
            i18n.t(
                preset.labelKey ||
                    `bubble${preset.key.charAt(0).toUpperCase() + preset.key.slice(1)}`,
            );

        const buildForm = (currentMode: string) => {
            const cfg = getBubble();
            const currentScaleKey = getTextSizePresetKey(cfg.textScale);

            const sizeBtns = TEXT_SIZE_PRESETS.map((p) => {
                const active =
                    currentScaleKey === p.key ? " settings-lang-btn--active" : "";
                return `<button class="settings-lang-btn${active}" data-size="${p.key}">${sizeLabel(p)}</button>`;
            }).join("");

            return `
                <div class="settings-form">
                    <div class="settings-row">
                        <span class="settings-label">${i18n.t("nameMode")}</span>
                        <div class="settings-lang-btns">
                            <button class="settings-lang-btn ${currentMode === "autodetected" ? "settings-lang-btn--active" : ""}" data-mode="autodetected">${i18n.t("autodetectedNames")}</button>
                            <button class="settings-lang-btn ${currentMode === "pooled" ? "settings-lang-btn--active" : ""}" data-mode="pooled">${i18n.t("pooledRandomNames")}</button>
                        </div>
                    </div>
                    <div class="settings-note">${i18n.t("providerNameModeNote")}</div>
                    <div class="settings-divider"></div>
                    <div class="settings-row">
                        <span class="settings-label">${i18n.t("textSize")}</span>
                        <div class="settings-lang-btns">
                            ${sizeBtns}
                        </div>
                    </div>
                </div>
            `;
        };

        btn.addEventListener("click", () => {
            const currentMode = getNameMode();
            if (this.modal)
                this.modal.open(i18n.t("settingsTitle"), buildForm(currentMode));

            document
                .querySelectorAll(".settings-lang-btn[data-mode]")
                .forEach((modeBtnNode) => {
                    const modeBtn = modeBtnNode as HTMLElement;
                    modeBtn.addEventListener("click", () => {
                        const nextMode = modeBtn.dataset.mode;
                        if (nextMode === getNameMode()) return;
                        if (nextMode) setNameMode(nextMode);
                        if (this.world) {
                            for (const agent of this.world.agents.values()) {
                                agent.regenerateName();
                            }
                        }
                        if (this.sidebar) this.sidebar.render();
                        if (this.dashboardRenderer && (this.dashboardRenderer as any).active) {
                            (this.dashboardRenderer as any).render();
                        }
                        if (this.activityPanel?.currentAgent) {
                            this.activityPanel._updateInfo(this.activityPanel.currentAgent);
                            this.activityPanel._updateCurrentTool(
                                this.activityPanel.currentAgent,
                            );
                        }
                        if (this.modal) this.modal.close();
                        if (this.toast) {
                            const modeLabel = i18n.t(
                                nextMode === "pooled"
                                    ? "pooledRandomNames"
                                    : "autodetectedNames",
                            );
                            this.toast.show(
                                i18n.t("nameModeChanged", { mode: modeLabel }),
                                "success",
                            );
                        }
                    });
                });

            document
                .querySelectorAll(".settings-lang-btn[data-size]")
                .forEach((sizeBtnNode) => {
                    const sizeBtn = sizeBtnNode as HTMLElement;
                    sizeBtn.addEventListener("click", () => {
                        const key = sizeBtn.dataset.size;
                        const preset = TEXT_SIZE_PRESETS.find((p) => p.key === key);
                        if (!preset) return;
                        updateBubbleConfig({
                            textScale: preset.textScale,
                            statusFontSize: preset.statusFontSize,
                            statusMaxWidth: preset.maxWidth,
                            statusBubbleH: preset.bubbleH,
                            statusPaddingH: preset.paddingH,
                            chatFontSize: preset.statusFontSize,
                        });
                        const cfg = getBubble();
                        document
                            .querySelectorAll(".settings-lang-btn[data-size]")
                            .forEach((btnNode) => {
                                const btn = btnNode as HTMLElement;
                                const p = TEXT_SIZE_PRESETS.find(
                                    (tp) => tp.key === btn.dataset.size,
                                );
                                btn.classList.toggle(
                                    "settings-lang-btn--active",
                                    p !== undefined && p.textScale === cfg.textScale,
                                );
                            });
                        if (this.toast) {
                            this.toast.show(i18n.t("settingsSaved"), "success");
                        }
                    });
                });
        });
    }

    _applyI18n() {
        document.querySelectorAll("[data-i18n]").forEach((elNode) => {
            const el = elNode as HTMLElement;
            const key = el.dataset.i18n;
            if (!key) return;
            const val = i18n.t(key);
            if (typeof val === "string") {
                el.textContent = val;
            }
        });
    }

    _showBootError(err: Error) {
        document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                        font-family:'Press Start 2P',monospace;color:#ef4444;font-size:10px;
                        flex-direction:column;gap:16px;background:#0a0a0f;">
                <div>BOOT FAILED</div>
                <div style="color:#8b8b9e;font-size:7px;">${err.message}</div>
                <div style="color:#8b8b9e;font-size:7px;">Check console for details</div>
            </div>
        `;
    }
}

// Need these imports for eventBus, i18n, etc.
import { eventBus } from "../domain/events/DomainEvent.js";
import { i18n } from "../config/i18n.js";

// Boot
window.addEventListener("load", () => {
    const app = new App();
    app.boot();
});