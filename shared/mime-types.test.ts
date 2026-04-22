import { describe, it, expect } from 'vitest';
import { MIME_TYPES } from './mime-types.js';

describe('MIME_TYPES', () => {
  it('should export an object with correct MIME types', () => {
    expect(MIME_TYPES).toBeDefined();
    expect(typeof MIME_TYPES).toBe('object');

    // Check specific important mappings
    expect(MIME_TYPES['.html']).toBe('text/html; charset=utf-8');
    expect(MIME_TYPES['.js']).toBe('application/javascript; charset=utf-8');
    expect(MIME_TYPES['.json']).toBe('application/json; charset=utf-8');
    expect(MIME_TYPES['.png']).toBe('image/png');
  });

  it('should handle charset where appropriate', () => {
    // Text-based files should have charset=utf-8
    expect(MIME_TYPES['.css']).toContain('charset=utf-8');
    expect(MIME_TYPES['.txt']).toContain('charset=utf-8');
    expect(MIME_TYPES['.mjs']).toContain('charset=utf-8');

    // Images/binary shouldn't have charset
    expect(MIME_TYPES['.svg']).not.toContain('charset');
    expect(MIME_TYPES['.jpg']).not.toContain('charset');
    expect(MIME_TYPES['.woff']).not.toContain('charset');
  });

  it('should include common image formats', () => {
    expect(MIME_TYPES['.jpeg']).toBe('image/jpeg');
    expect(MIME_TYPES['.gif']).toBe('image/gif');
    expect(MIME_TYPES['.ico']).toBe('image/x-icon');
  });

  it('should include common font formats', () => {
    expect(MIME_TYPES['.woff2']).toBe('font/woff2');
    expect(MIME_TYPES['.ttf']).toBe('font/ttf');
  });
});
