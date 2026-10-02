import type { Agent } from '../entities/Agent.js';
import type { WsMessage } from '../../infrastructure/WebSocketClient.js';

/**
 * Payload of the hub's WebSocket frame. The hub is an untyped snapshot source
 * (hubreceiver/state.ts), so `sessions` and friends stay unknown - typing them
 * is what #125's remaining adapter-layer work is for.
 */
export type HubWsMessage = WsMessage;

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

/** A subscriber for any event, mapped or not. */
type AnySubscriber = (data: any) => void;

// Singleton event bus (observer pattern)
class DomainEvent {
    /**
     * One map holds every event, so a single Set cannot preserve each entry's
     * payload type; entries are stored erased. `emit` and the first `on`
     * overload below are the checked boundary - this erasure is not what makes
     * them type safe.
     */
    listeners: Map<string, Set<AnySubscriber>>;

    constructor() {
        this.listeners = new Map();
    }

    /**
     * Known events are payload-checked. The fallback overload keeps the bus's
     * real runtime contract - open string keys - for subscribing to an event
     * this map does not cover yet.
     */
    on<K extends DomainEventName>(event: K, callback: (data: DomainEventMap[K]) => void): () => void;
    on(event: string, callback: AnySubscriber): () => void;
    on(event: string, callback: AnySubscriber) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
        return () => this.off(event, callback);
    }

    off(event: string, callback: AnySubscriber) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * Deliberately closed: emitting an event this map does not declare is a
     * bug, and the variadic form lets a `void` payload be emitted with no
     * argument while every other event still requires its payload. There is no
     * string-keyed fallback on purpose - adding one makes every payload check
     * vanish, because `(event: string, data?: unknown)` accepts any argument.
     *
     * Tests emit fixture names such as `test:basic` that no production code
     * emits; they are not typechecked because tsconfig excludes *.test.ts.
     */
    emit<K extends DomainEventName>(
        event: K,
        ...args: DomainEventMap[K] extends void ? [] : [data: DomainEventMap[K]]
    ) {
        const data = args[0];
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            for (const callback of callbacks) {
                callback(data);
            }
        }
    }
}

export const eventBus = new DomainEvent();
