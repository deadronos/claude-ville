// Singleton event bus (observer pattern)
class DomainEvent {
    listeners: Map<string, Set<Function>>;

    constructor() {
        this.listeners = new Map();
    }

    on(event: string, callback: (data?: unknown) => void) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
        return () => this.off(event, callback);
    }

    off(event: string, callback: (data?: unknown) => void) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    emit(event: string, data?: unknown) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            for (const callback of callbacks) {
                callback(data);
            }
        }
    }
}

export const eventBus = new DomainEvent();
