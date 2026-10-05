import { describe, expect, it } from 'vitest';
import { isAgentEntity, type Entity } from './world.js';
import { Appearance } from '../../../../domain/value-objects/Appearance.js';

function validAppearance(): Appearance {
  return new Appearance({
    skin: '#f1c27d',
    shirt: '#336699',
    hair: '#222222',
    hairStyle: 'short',
    pants: '#224466',
    accessory: 'none',
    eyeStyle: 'normal',
  });
}

function validEntity(): Entity {
  return {
    Agent: true,
    id: 'a1',
    name: 'Alice',
    status: 'working',
    bubbleText: null,
    appearance: validAppearance(),
  };
}

describe('isAgentEntity totality', () => {
  it('accepts an entity with every required field present', () => {
    expect(isAgentEntity(validEntity())).toBe(true);
  });

  it('accepts a string bubbleText as well as null', () => {
    const entity = validEntity();
    entity.bubbleText = 'hello';
    expect(isAgentEntity(entity)).toBe(true);
  });

  it.each([
    ['Agent', () => {
      const entity = validEntity();
      delete entity.Agent;
      return entity;
    }],
    ['id', () => {
      const entity = validEntity();
      delete entity.id;
      return entity;
    }],
    ['name', () => {
      const entity = validEntity();
      delete entity.name;
      return entity;
    }],
    ['status', () => {
      const entity = validEntity();
      delete entity.status;
      return entity;
    }],
    ['bubbleText', () => {
      const entity = validEntity();
      delete entity.bubbleText;
      return entity;
    }],
    ['appearance', () => {
      const entity = validEntity();
      delete entity.appearance;
      return entity;
    }],
  ])('rejects an entity missing %s', (_field, build) => {
    expect(isAgentEntity(build())).toBe(false);
  });
});
