import { World } from '../domain/entities/World.js';
import { Building } from '../domain/entities/Building.js';
import { BUILDING_DEFS } from '../config/buildings.js';
import { eventBus } from '../domain/events/DomainEvent.js';
import { i18n } from '../config/i18n.js';

import { ClaudeDataSource } from '../infrastructure/ClaudeDataSource.js';
import { WebSocketClient } from '../infrastructure/WebSocketClient.js';

import { AgentManager } from '../application/AgentManager.js';
import { ModeManager } from '../application/ModeManager.js';
import { SessionWatcher } from '../application/SessionWatcher.js';
import { NotificationService } from '../application/NotificationService.js';
import { getNameMode, setNameMode } from '../config/agentNames.js';
import { getBubbleConfig, updateBubbleConfig } from '../config/bubbleConfig.js';

import { TopBar } from './shared/TopBar.js';
import { Sidebar } from './shared/Sidebar.js';
import { Toast } from './shared/Toast.js';
import { Modal } from './shared/Modal.js';
import { ActivityPanel } from './shared/ActivityPanel.js';

class App {
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
    }

    async boot() {
        try {
            console.log('[App] ClaudeVille booting...');

            // 1. Initialize domain
            this.world = new World();
            for (const def of BUILDING_DEFS) {
                this.world.addBuilding(new Building(def));
            }

            // 2. Initialize infrastructure
            this.dataSource = new ClaudeDataSource();
            this.wsClient = new WebSocketClient();

            // 3. Initialize UI components
            this.toast = new Toast();
            this.modal = new Modal();
            this.topBar = new TopBar(this.world);
            this.sidebar = new Sidebar(this.world);

            // 4. Initialize application services
            this.agentManager = new AgentManager(this.world, this.dataSource);
            this.modeManager = new ModeManager();
            this.notificationService = new NotificationService(this.toast);

            // 5. Load initial data
            await this.agentManager.loadInitialData();

            // 5-1. Load initial usage data
            this.dataSource.getUsage().then(usage => {
                if (usage) eventBus.emit('usage:updated', usage);
            });

            // 6. Start session watching
            this.sessionWatcher = new SessionWatcher(
                this.agentManager, this.wsClient, this.dataSource
            );
            this.sessionWatcher.start();

            // 7. Handle canvas resize (must run before renderer to set canvas size)
            this._bindResize();

            // 8. Dynamically load character renderer
            await this._loadRenderer();

            // 8-1. Load dashboard renderer
            await this._loadDashboard();

            // 9. Right-side real-time activity panel
            this.activityPanel = new ActivityPanel();
            this._bindAgentFollow();

            // 10. Settings button
            this._bindSettings();

            // 11. Apply initial i18n
            this._applyI18n();

            console.log('[App] ClaudeVille boot complete!');
        } catch (err) {
            console.error('[App] Boot failed:', err);
            this._showBootError(err);
        }
    }

    async _loadRenderer() {
        try {
            const module = await import('./character-mode/IsometricRenderer.js');
            const canvas = document.getElementById('worldCanvas');

            if (module.IsometricRenderer && canvas) {
                this.renderer = new module.IsometricRenderer(this.world);
                this.renderer.show(canvas);
                // Re-center camera after canvas size is determined
                if (this.renderer.camera) {
                    this.renderer.camera.centerOnMap();
                }
                this.renderer.onAgentSelect = (agent) => {
                    if (agent) eventBus.emit('agent:selected', agent);
                };
                console.log('[App] IsometricRenderer loaded');
            }
        } catch (err) {
            console.warn('[App] IsometricRenderer not yet available (waiting for canvas-artist):', err.message);
        }
    }

    async _loadDashboard() {
        try {
            const module = await import('./dashboard-mode/DashboardRenderer.js');
            if (module.DashboardRenderer) {
                this.dashboardRenderer = new module.DashboardRenderer(this.world);
                console.log('[App] DashboardRenderer loaded');
            }
        } catch (err) {
            console.warn('[App] DashboardRenderer load failed:', err.message);
        }
    }

    _bindAgentFollow() {
        // Follow camera when agent is selected
        eventBus.on('agent:selected', (agent) => {
            if (agent && this.renderer) {
                this.renderer.selectAgentById(agent.id);
            }
        });

        // Release follow when panel is closed
        eventBus.on('agent:deselected', () => {
            if (this.renderer) {
                this.renderer.selectAgentById(null);
            }
        });
    }

    _bindResize() {
        const canvas = document.getElementById('worldCanvas');
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

        // Use ResizeObserver to detect container size changes (including footer open/close)
        this._resizeObserver = new ResizeObserver(() => resize());
        this._resizeObserver.observe(container);

        window.addEventListener('resize', resize);
        resize();
    }

    _bindSettings() {
        const btn = document.getElementById('btnSettings');
        if (!btn) return;

        const BUBBLE_PRESETS = [
            { key: 'small',  labelKey: 'bubbleSmall',       fontSize: 10, maxWidth: 160, bubbleH: 22, paddingH: 18 },
            { key: 'medium', labelKey: 'bubbleMedium',      fontSize: 14, maxWidth: 260, bubbleH: 28, paddingH: 24 },
            { key: 'large',  labelKey: 'bubbleLarge',       fontSize: 20, maxWidth: 360, bubbleH: 38, paddingH: 32 },
            { key: 'xlarge', labelKey: 'bubbleExtraLarge',  fontSize: 28, maxWidth: 480, bubbleH: 52, paddingH: 44 },
        ];

        const CHAT_PRESETS = [
            { key: 'small',  fontSize: 10 },
            { key: 'medium', fontSize: 14 },
            { key: 'large',  fontSize: 20 },
            { key: 'xlarge', fontSize: 28 },
        ];

        const bubbleLabel = (preset) => i18n.t(preset.labelKey || `bubble${preset.key.charAt(0).toUpperCase() + preset.key.slice(1)}`);
        const chatLabel  = (preset) => i18n.t(preset.labelKey || `chat${preset.key.charAt(0).toUpperCase() + preset.key.slice(1)}`);

        const bubbleBtns = (presets, currentKey) => {
            return presets.map(p => {
                const active = currentKey === p.key ? ' settings-lang-btn--active' : '';
                return `<button class="settings-lang-btn${active}" data-size="${p.key}">${bubbleLabel(p)}</button>`;
            }).join('');
        };

        const buildForm = (currentMode) => {
            const cfg = getBubbleConfig();
            const sizeToKey = (v, fallback) => {
                const found = BUBBLE_PRESETS.find(p => p.fontSize === v);
                return found ? found.key : fallback;
            };
            const chatSizeToKey = (v) => {
                const found = CHAT_PRESETS.find(p => p.fontSize === v);
                return found ? found.key : 'medium';
            };
            const currentBubble = sizeToKey(cfg.statusFontSize, 'medium');
            const currentChat = chatSizeToKey(cfg.chatFontSize);

            return `
                <div class="settings-form">
                    <div class="settings-row">
                        <span class="settings-label">${i18n.t('nameMode')}</span>
                        <div class="settings-lang-btns">
                            <button class="settings-lang-btn ${currentMode === 'autodetected' ? 'settings-lang-btn--active' : ''}" data-mode="autodetected">${i18n.t('autodetectedNames')}</button>
                            <button class="settings-lang-btn ${currentMode === 'pooled' ? 'settings-lang-btn--active' : ''}" data-mode="pooled">${i18n.t('pooledRandomNames')}</button>
                        </div>
                    </div>
                    <div class="settings-note">${i18n.t('providerNameModeNote')}</div>
                    <div class="settings-divider"></div>
                    <div class="settings-row">
                        <span class="settings-label">${i18n.t('bubbleSize')}</span>
                        <div class="settings-lang-btns">
                            ${bubbleBtns(BUBBLE_PRESETS, currentBubble)}
                        </div>
                    </div>
                    <div class="settings-row">
                        <span class="settings-label">${i18n.t('chatSize')}</span>
                        <div class="settings-lang-btns">
                            ${bubbleBtns(CHAT_PRESETS, currentChat)}
                        </div>
                    </div>
                </div>
            `;
        };

        btn.addEventListener('click', () => {
            const currentMode = getNameMode();
            this.modal.open(i18n.t('settingsTitle'), buildForm(currentMode));

            // Name mode buttons
            document.querySelectorAll('.settings-lang-btn[data-mode]').forEach(modeBtn => {
                modeBtn.addEventListener('click', () => {
                    const nextMode = modeBtn.dataset.mode;
                    if (nextMode === getNameMode()) return;
                    setNameMode(nextMode);
                    for (const agent of this.world.agents.values()) {
                        agent.regenerateName();
                    }
                    this.sidebar.render();
                    if (this.dashboardRenderer && this.dashboardRenderer.active) {
                        this.dashboardRenderer.render();
                    }
                    if (this.activityPanel?.currentAgent) {
                        this.activityPanel._updateInfo(this.activityPanel.currentAgent);
                        this.activityPanel._updateCurrentTool(this.activityPanel.currentAgent);
                    }
                    this.modal.close();
                    if (this.toast) {
                        this.toast.show(i18n.t('nameModeChanged')(i18n.t(nextMode === 'pooled' ? 'pooledRandomNames' : 'autodetectedNames')), 'success');
                    }
                });
            });

            // Status bubble size buttons
            document.querySelectorAll('.settings-lang-btn[data-size]').forEach(sizeBtn => {
                sizeBtn.addEventListener('click', () => {
                    const key = sizeBtn.dataset.size;
                    const preset = BUBBLE_PRESETS.find(p => p.key === key);
                    const chatPreset = CHAT_PRESETS.find(p => p.key === key);
                    if (!preset) return;
                    updateBubbleConfig({
                        statusFontSize: preset.fontSize,
                        statusMaxWidth: preset.maxWidth,
                        statusBubbleH: preset.bubbleH,
                        statusPaddingH: preset.paddingH,
                        chatFontSize: chatPreset ? chatPreset.fontSize : cfg.chatFontSize,
                    });
                    if (this.toast) {
                        this.toast.show(i18n.t('settingsSaved'), 'success');
                    }
                });
            });
        });
    }

    _applyI18n() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const val = i18n.t(key);
            if (typeof val === 'string') {
                el.textContent = val;
            }
        });
    }

    _showBootError(err) {
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

// Boot
window.addEventListener('load', () => {
    const app = new App();
    app.boot();
});
