/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from './NotificationService.js';

describe('NotificationService', () => {
  let mockToast: any;

  beforeEach(() => {
    mockToast = { show: vi.fn() };
  });

  // Helper: create a fresh service and clean up its listeners
  function makeService(): NotificationService {
    const svc = new NotificationService(mockToast);
    return svc;
  }

  function destroyAndClean(svc: NotificationService) {
    svc.destroy();
  }

  describe('constructor', () => {
    it('initializes with empty knownAgents set', () => {
      const svc = makeService();
      expect(svc.knownAgents.size).toBe(0);
      destroyAndClean(svc);
    });

    it('initializes wsEverConnected as false', () => {
      const svc = makeService();
      expect(svc.wsEverConnected).toBe(false);
      destroyAndClean(svc);
    });
  });

  describe('agent:added event', () => {
    it('shows toast when agent is added after first agent', () => {
      const svc = makeService();
      svc.knownAgents.add('pre-existing-agent');
      svc['_onAgentAdded']({ id: 'new-agent', name: 'NewAgent' });
      expect(mockToast.show).toHaveBeenCalledWith('NewAgent joined the village', 'info');
      destroyAndClean(svc);
    });

    it('does not show toast for the very first agent', () => {
      const svc = makeService();
      svc['_onAgentAdded']({ id: 'first-agent', name: 'FirstAgent' });
      expect(mockToast.show).not.toHaveBeenCalled();
      destroyAndClean(svc);
    });

    it('adds agent id to knownAgents', () => {
      const svc = makeService();
      svc['_onAgentAdded']({ id: 'agent-x', name: 'X' });
      expect(svc.knownAgents.has('agent-x')).toBe(true);
      destroyAndClean(svc);
    });
  });

  describe('agent:removed event', () => {
    it('shows toast when agent leaves', () => {
      const svc = makeService();
      svc.knownAgents.add('agent-to-leave');
      svc['_onAgentRemoved']({ id: 'agent-to-leave', name: 'LeavingAgent' });
      expect(mockToast.show).toHaveBeenCalledWith('LeavingAgent left the village', 'warning');
      destroyAndClean(svc);
    });

    it('removes agent from knownAgents', () => {
      const svc = makeService();
      svc.knownAgents.add('agent-y');
      svc['_onAgentRemoved']({ id: 'agent-y', name: 'Y' });
      expect(svc.knownAgents.has('agent-y')).toBe(false);
      destroyAndClean(svc);
    });
  });

  describe('ws:connected event', () => {
    it('sets wsEverConnected to true', () => {
      const svc = makeService();
      expect(svc.wsEverConnected).toBe(false);
      svc['_onWsConnected']();
      expect(svc.wsEverConnected).toBe(true);
      destroyAndClean(svc);
    });

    it('shows success toast', () => {
      const svc = makeService();
      svc['_onWsConnected']();
      expect(mockToast.show).toHaveBeenCalledWith('Server connected', 'success');
      destroyAndClean(svc);
    });
  });

  describe('ws:disconnected event', () => {
    it('shows warning toast when previously connected', () => {
      const svc = makeService();
      svc.wsEverConnected = true;
      svc['_onWsDisconnected']();
      expect(mockToast.show).toHaveBeenCalledWith('Server disconnected, retrying...', 'warning');
      destroyAndClean(svc);
    });

    it('does not show toast on first disconnect (never connected)', () => {
      const svc = makeService();
      svc.wsEverConnected = false;
      svc['_onWsDisconnected']();
      expect(mockToast.show).not.toHaveBeenCalled();
      destroyAndClean(svc);
    });
  });

  describe('mode:changed event', () => {
    it('shows info toast for character mode', () => {
      const svc = makeService();
      svc['_onModeChanged']('character');
      expect(mockToast.show).toHaveBeenCalledWith('Switched to World mode', 'info');
      destroyAndClean(svc);
    });

    it('shows info toast for dashboard mode', () => {
      const svc = makeService();
      svc['_onModeChanged']('dashboard');
      expect(mockToast.show).toHaveBeenCalledWith('Switched to Dashboard mode', 'info');
      destroyAndClean(svc);
    });
  });

  describe('destroy()', () => {
    it('removes all event listeners', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const svc = makeService();
      svc.knownAgents.add('pre');
      destroyAndClean(svc);
      // After destroy, events emitted via eventBus should not trigger toast
      eventBus.emit('agent:removed', { id: 'pre', name: 'P' });
      expect(mockToast.show).not.toHaveBeenCalled();
    });
  });
});
