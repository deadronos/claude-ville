import { Agent } from '../entities/Agent.js';

/**
 * Payload of the hub's WebSocket frame, as WebSocketClient models it: a tagged
 * envelope with untyped extras. The hub is an untyped snapshot source
 * (hubreceiver/state.ts), so `sessions` and friends stay unknown here — typing
 * them is what #125's remaining adapter-layer work is for.
 */
export interface HubWsMessage {
    type: string;
    usage?: unknown;
    [key: string]: unknown;
}

/**
 * The bus's event -> payload contract. Subscribers used to annotate their own
 * parameter, which meant the annotation was a local assertion nothing checked:
 * renaming a payload field or emitting a different shape still compiled. Mapping
 * the events here moves that check to emit time and to every subscriber at once.
 */
export interface DomainEventMap {
    'agent:added': Agent;
    'agent:updated': Agent;
    'agent:removed': Agent;
    'usage:updated': unknown;
    'ws:init': HubWsMessage;
    'ws:update': HubWsMessage;
    'ws:connected': void;
    'ws:disconnected': void;
}

export type DomainEventName = keyof DomainEventMap;

// Singleton event bus (observer pattern)
class DomainEvent {
    listeners: Map<DomainEventName, Set<(data: never) => void>>;

    constructor() {
        this.listeners = new Map();
    }

    on<K extends DomainEventName>(event: K, callback: (data: DomainEventMap[K]) => void) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        // Every stored callback is invoked with its own event's payload, so the
        // set is heterogeneous by construction and erased to `never` here.
        this.listeners.get(event)!.add(callback as (data: never) => void);
        return () => this.off(event, callback);
    }

    off<K extends DomainEventName>(event: K, callback: (data: DomainEventMap[K]) => void) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.delete(callback as (data: never) => void);
            if (callbacks.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * Variadic so a `void` payload can be emitted with no argument while every
     * other event still requires its payload.
     */
    emit<K extends DomainEventName>(
        event: K,
        ...args: DomainEventMap[K] extends void ? [] : [data: DomainEventMap[K]]
    ) {
        const data = args[0] as DomainEventMap[K];
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            for (const callback of callbacks) {
                (callback as (payload: DomainEventMap[K]) => void)(data);
            }
        }
    }
}

export const eventBus = new DomainEvent();
