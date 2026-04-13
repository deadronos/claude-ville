import { describe, it, expect } from 'vitest';
import { Task } from './Task.js';

describe('Task', () => {
  const makeTask = (overrides = {}) =>
    new Task({
      id: 'task-1',
      subject: 'Fix the bug',
      description: 'Detailed description',
      status: 'pending',
      owner: 'agent-1',
      blockedBy: [],
      activeForm: null,
      ...overrides,
    });

  describe('constructor', () => {
    it('stores all provided properties', () => {
      const task = makeTask();
      expect(task.id).toBe('task-1');
      expect(task.subject).toBe('Fix the bug');
      expect(task.description).toBe('Detailed description');
      expect(task.status).toBe('pending');
      expect(task.owner).toBe('agent-1');
      expect(task.blockedBy).toEqual([]);
    });

    it('defaults status to pending when not provided', () => {
      const task = new Task({
        id: 't1', subject: 's', description: 'd',
        status: undefined, owner: 'o', blockedBy: [], activeForm: null,
      });
      expect(task.status).toBe('pending');
    });

    it('defaults blockedBy to empty array when not provided', () => {
      const task = new Task({
        id: 't1', subject: 's', description: 'd',
        status: 'pending', owner: 'o', blockedBy: undefined, activeForm: null,
      });
      expect(task.blockedBy).toEqual([]);
    });

    it('stores activeForm', () => {
      const task = makeTask({ activeForm: { type: 'review' } });
      expect(task.activeForm).toEqual({ type: 'review' });
    });
  });

  describe('isBlocked', () => {
    it('is false when blockedBy is empty', () => {
      const task = makeTask({ blockedBy: [] });
      expect(task.isBlocked).toBe(false);
    });

    it('is true when blockedBy has entries', () => {
      const task = makeTask({ blockedBy: ['task-2'] });
      expect(task.isBlocked).toBe(true);
    });

    it('is true when blockedBy has multiple entries', () => {
      const task = makeTask({ blockedBy: ['task-2', 'task-3'] });
      expect(task.isBlocked).toBe(true);
    });
  });

  describe('isCompleted', () => {
    it('is false for pending status', () => {
      const task = makeTask({ status: 'pending' });
      expect(task.isCompleted).toBe(false);
    });

    it('is true for completed status', () => {
      const task = makeTask({ status: 'completed' });
      expect(task.isCompleted).toBe(true);
    });

    it('is false for in_progress status', () => {
      const task = makeTask({ status: 'in_progress' });
      expect(task.isCompleted).toBe(false);
    });
  });

  describe('isInProgress', () => {
    it('is false for pending status', () => {
      const task = makeTask({ status: 'pending' });
      expect(task.isInProgress).toBe(false);
    });

    it('is true for in_progress status', () => {
      const task = makeTask({ status: 'in_progress' });
      expect(task.isInProgress).toBe(true);
    });

    it('is false for completed status', () => {
      const task = makeTask({ status: 'completed' });
      expect(task.isInProgress).toBe(false);
    });
  });
});
