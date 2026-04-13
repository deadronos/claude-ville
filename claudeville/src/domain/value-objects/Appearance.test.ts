import { describe, it, expect } from 'vitest';
import { Appearance } from './Appearance.js';

describe('Appearance', () => {
  describe('hashCode', () => {
    it('returns a number', () => {
      expect(typeof Appearance.hashCode('test')).toBe('number');
    });

    it('is deterministic for same input', () => {
      expect(Appearance.hashCode('agent-123')).toBe(Appearance.hashCode('agent-123'));
    });

    it('produces different values for different inputs', () => {
      expect(Appearance.hashCode('abc')).not.toBe(Appearance.hashCode('def'));
    });

    it('handles empty string', () => {
      expect(typeof Appearance.hashCode('')).toBe('number');
      expect(Appearance.hashCode('')).toBe(0);
    });

    it('handles unicode', () => {
      expect(typeof Appearance.hashCode('🤖')).toBe('number');
    });
  });

  describe('fromHash', () => {
    it('returns an Appearance instance', () => {
      expect(Appearance.fromHash('agent-1')).toBeInstanceOf(Appearance);
    });

    it('is deterministic for same id', () => {
      const a1 = Appearance.fromHash('same-id');
      const a2 = Appearance.fromHash('same-id');
      expect(a1.skin).toBe(a2.skin);
      expect(a1.shirt).toBe(a2.shirt);
      expect(a1.hair).toBe(a2.hair);
      expect(a1.hairStyle).toBe(a2.hairStyle);
      expect(a1.pants).toBe(a2.pants);
      expect(a1.accessory).toBe(a2.accessory);
      expect(a1.eyeStyle).toBe(a2.eyeStyle);
    });

    it('produces different appearances for different ids', () => {
      const a1 = Appearance.fromHash('agent-aaa');
      const a2 = Appearance.fromHash('agent-zzz');
      // At least one property should differ
      const same = a1.skin === a2.skin && a1.shirt === a2.shirt && a1.hairStyle === a2.hairStyle;
      expect(same).toBe(false);
    });

    it('has valid skin color (hex format)', () => {
      const a = Appearance.fromHash('test-agent');
      expect(a.skin).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('has valid shirt color (hex format)', () => {
      const a = Appearance.fromHash('test-agent');
      expect(a.shirt).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('has a valid hair style string', () => {
      const valid = ['short', 'long', 'spiky', 'bald', 'mohawk'];
      const a = Appearance.fromHash('test-agent');
      expect(valid).toContain(a.hairStyle);
    });

    it('has a valid accessory', () => {
      const valid = ['none', 'crown', 'glasses', 'headphones', 'hat'];
      const a = Appearance.fromHash('test-agent');
      expect(valid).toContain(a.accessory);
    });

    it('has a valid eye style', () => {
      const valid = ['normal', 'happy', 'determined', 'sleepy'];
      const a = Appearance.fromHash('test-agent');
      expect(valid).toContain(a.eyeStyle);
    });
  });

  describe('constructor', () => {
    it('stores all properties', () => {
      const a = new Appearance({
        skin: '#ffdbac',
        shirt: '#4a9eff',
        hair: '#2c1810',
        hairStyle: 'short',
        pants: '#2d3436',
        accessory: 'none',
        eyeStyle: 'normal',
      });
      expect(a.skin).toBe('#ffdbac');
      expect(a.shirt).toBe('#4a9eff');
      expect(a.hair).toBe('#2c1810');
      expect(a.hairStyle).toBe('short');
      expect(a.pants).toBe('#2d3436');
      expect(a.accessory).toBe('none');
      expect(a.eyeStyle).toBe('normal');
    });
  });
});
