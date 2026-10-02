import type { Agent } from '../entities/Agent.js';
import type { WsMessage } from '../../../shared/types.js';

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

/**
 * Subscriber as stored. One map holds every event, so a Set cannot preserve each
 * entry's payload type; entries are kept erased at the storage layer only. This
 * alias is never part of a public signature - `on`/`off`/`emit` are the checked
 * boundary.
 */
type StoredSubscriber = (data: any) => void;

// Singleton event bus (observer pattern)
class DomainEvent {
    listeners: Map<string, Set<StoredSubscriber>>;

    constructor() {
        this.listeners = new Map();
    }

    /**
     * Deliberately closed, matching emit. An earlier version had a
     * `(event: string, callback: AnySubscriber)` fallback so unmapped names could
     * still be subscribed, but it made the payload check bypassable: any
     * annotated callback selected the fallback, so `on('agent:added', (d: Wrong)
     * => ...)` compiled. `Exclude<string, DomainEventName>` is not a fix -
     * string is not a union of literals, so it excludes nothing. No production
     * code subscribes to an unmapped name; tests emit fixture names such as
     * `test:basic`, and they are not typechecked because tsconfig excludes
     * *.test.ts.
     */
    on<K extends DomainEventName>(event: K, callback: (data: DomainEventMap[K]) => void) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(callback);
        return () => this.off(event, callback);
    }

    off<K extends DomainEventName>(event: K, callback: (data: DomainEventMap[K]) => void) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.listeners.delete(event);
            }
        }
    }

    /**
     * Closed for the same reason as `on`: emitting an event this map does not
     * declare is a bug, and a string-keyed fallback would accept any argument.
     * The variadic form lets a `void` payload be emitted with no argument while
     * every other event still requires its payload.
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
