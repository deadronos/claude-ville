import { World } from '../../domain/entities/World.js';
import { eventBus } from '../../domain/events/DomainEvent.js';

export class TopBar {
    world: World;
    els: { [key: string]: HTMLElement };
    timeInterval: ReturnType<typeof setInterval> | null;
    _onUpdate: () => void;

    constructor(world: World) {
        this.world = world;
        this.els = {
            time: document.getElementById('statTime') as HTMLElement,
            working: document.getElementById('badgeWorking') as HTMLElement,
            idle: document.getElementById('badgeIdle') as HTMLElement,
            waiting: document.getElementById('badgeWaiting') as HTMLElement,
        };
        this.timeInterval = null;

        this._onUpdate = () => this.render();
        eventBus.on('agent:added', this._onUpdate as (data?: unknown) => void);
        eventBus.on('agent:updated', this._onUpdate as (data?: unknown) => void);
        eventBus.on('agent:removed', this._onUpdate as (data?: unknown) => void);

        this._startTimer();
        this.render();
    }

    render() {
        const stats = this.world.getStats();
        this.els.working.textContent = String(stats.working);
        this.els.idle.textContent = String(stats.idle);
        this.els.waiting.textContent = String(stats.waiting);
    }

    _startTimer() {
        this.timeInterval = setInterval(() => {
            const seconds = this.world.activeTime;
            const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
            const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
            const s = String(seconds % 60).padStart(2, '0');
            this.els.time.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }

    destroy() {
        if (this.timeInterval) clearInterval(this.timeInterval);
        eventBus.off('agent:added', this._onUpdate);
        eventBus.off('agent:updated', this._onUpdate);
        eventBus.off('agent:removed', this._onUpdate);
    }
}
