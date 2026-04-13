import { describe, it, expect, vi } from 'vitest';
import { eventBus } from './DomainEvent.js';

describe('DomainEvent (eventBus)', () => {
  describe('on / emit', () => {
    it('calls registered listener when event is emitted', () => {
      const handler = vi.fn();
      eventBus.on('test:basic', handler);
      eventBus.emit('test:basic', { value: 42 });
      expect(handler).toHaveBeenCalledWith({ value: 42 });
      eventBus.off('test:basic', handler);
    });

    it('calls listener with undefined when no data provided', () => {
      const handler = vi.fn();
      eventBus.on('test:nodata', handler);
      eventBus.emit('test:nodata');
      expect(handler).toHaveBeenCalledWith(undefined);
      eventBus.off('test:nodata', handler);
    });

    it('calls multiple listeners for the same event', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      eventBus.on('test:multi', h1);
      eventBus.on('test:multi', h2);
      eventBus.emit('test:multi', 'payload');
      expect(h1).toHaveBeenCalledWith('payload');
      expect(h2).toHaveBeenCalledWith('payload');
      eventBus.off('test:multi', h1);
      eventBus.off('test:multi', h2);
    });

    it('does not call listeners for other events', () => {
      const handler = vi.fn();
      eventBus.on('test:isolated', handler);
      eventBus.emit('test:other');
      expect(handler).not.toHaveBeenCalled();
      eventBus.off('test:isolated', handler);
    });
  });

  describe('off', () => {
    it('removes listener so it is no longer called', () => {
      const handler = vi.fn();
      eventBus.on('test:off', handler);
      eventBus.off('test:off', handler);
      eventBus.emit('test:off');
      expect(handler).not.toHaveBeenCalled();
    });

    it('is safe to call off for a listener that was never added', () => {
      const handler = vi.fn();
      expect(() => eventBus.off('test:nonexistent', handler)).not.toThrow();
    });

    it('removes only the specific listener, not others', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      eventBus.on('test:partial-off', h1);
      eventBus.on('test:partial-off', h2);
      eventBus.off('test:partial-off', h1);
      eventBus.emit('test:partial-off', 'x');
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledWith('x');
      eventBus.off('test:partial-off', h2);
    });
  });

  describe('unsubscribe function returned from on()', () => {
    it('on() returns a function', () => {
      const unsub = eventBus.on('test:unsub-return', vi.fn());
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('calling returned function removes the listener', () => {
      const handler = vi.fn();
      const unsub = eventBus.on('test:unsub-fn', handler);
      unsub();
      eventBus.emit('test:unsub-fn');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('emit with no listeners', () => {
    it('does not throw when emitting an event with no listeners', () => {
      expect(() => eventBus.emit('test:empty-event')).not.toThrow();
    });
  });
});
