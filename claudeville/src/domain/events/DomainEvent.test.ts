import { describe, it, expect, vi } from 'vitest';
import { eventBus } from './DomainEvent.js';

// `DomainEvent.on`/`emit` are closed over `keyof DomainEventMap` (see
// DomainEvent.ts), so a fixture name like `test:basic` cannot be subscribed to
// or emitted. These tests exercise the bus mechanism - on/emit, off, the
// returned unsubscribe, isolation between events - not any particular payload,
// so they use the two mapped events whose payloads are deliberately
// unconstrained:
//
//   - `usage:updated` carries `unknown`, so it is the one event any payload can
//     be emitted under. Stands in for every `test:*` name that emitted data.
//   - `ws:connected` carries `void`, so `emit(name)` with no argument is only
//     legal for it. Stands in for every `test:*` name that emitted nothing.
//
// No assertion changed: every `expect` below is the same one as before, and
// `eventBus` is a per-file singleton (vitest isolates the module registry per
// test file), so reusing real event names cannot collide with another file.
describe('DomainEvent (eventBus)', () => {
  describe('on / emit', () => {
    it('calls registered listener when event is emitted', () => {
      const handler = vi.fn();
      eventBus.on('usage:updated', handler);
      eventBus.emit('usage:updated', { value: 42 });
      expect(handler).toHaveBeenCalledWith({ value: 42 });
      eventBus.off('usage:updated', handler);
    });

    it('calls listener with undefined when no data provided', () => {
      const handler = vi.fn();
      eventBus.on('ws:connected', handler);
      eventBus.emit('ws:connected');
      expect(handler).toHaveBeenCalledWith(undefined);
      eventBus.off('ws:connected', handler);
    });

    it('calls multiple listeners for the same event', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      eventBus.on('usage:updated', h1);
      eventBus.on('usage:updated', h2);
      eventBus.emit('usage:updated', 'payload');
      expect(h1).toHaveBeenCalledWith('payload');
      expect(h2).toHaveBeenCalledWith('payload');
      eventBus.off('usage:updated', h1);
      eventBus.off('usage:updated', h2);
    });

    it('does not call listeners for other events', () => {
      const handler = vi.fn();
      eventBus.on('usage:updated', handler);
      eventBus.emit('ws:connected');
      expect(handler).not.toHaveBeenCalled();
      eventBus.off('usage:updated', handler);
    });
  });

  describe('off', () => {
    it('removes listener so it is no longer called', () => {
      const handler = vi.fn();
      eventBus.on('ws:connected', handler);
      eventBus.off('ws:connected', handler);
      eventBus.emit('ws:connected');
      expect(handler).not.toHaveBeenCalled();
    });

    it('is safe to call off for a listener that was never added', () => {
      const handler = vi.fn();
      expect(() => eventBus.off('ws:connected', handler)).not.toThrow();
    });

    it('removes only the specific listener, not others', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      eventBus.on('usage:updated', h1);
      eventBus.on('usage:updated', h2);
      eventBus.off('usage:updated', h1);
      eventBus.emit('usage:updated', 'x');
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledWith('x');
      eventBus.off('usage:updated', h2);
    });
  });

  describe('unsubscribe function returned from on()', () => {
    it('on() returns a function', () => {
      const unsub = eventBus.on('usage:updated', vi.fn());
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('calling returned function removes the listener', () => {
      const handler = vi.fn();
      const unsub = eventBus.on('ws:connected', handler);
      unsub();
      eventBus.emit('ws:connected');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('emit with no listeners', () => {
    it('does not throw when emitting an event with no listeners', () => {
      expect(() => eventBus.emit('ws:connected')).not.toThrow();
    });
  });
});