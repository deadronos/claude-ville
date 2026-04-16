/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Modal } from './Modal.js';

describe('Modal', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="modalOverlay" style="display:none">
        <button id="modalClose">Close</button>
        <h2 id="modalTitle"></h2>
        <div id="modalContent"></div>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('opens and closes the modal from the close button and Escape key', () => {
    const modal = new Modal();

    modal.open('Settings', '<p>hello</p>');

    expect(modal.isOpen).toBe(true);
    expect(document.getElementById('modalTitle')?.textContent).toBe('Settings');
    expect(document.getElementById('modalContent')?.innerHTML).toBe('<p>hello</p>');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(modal.isOpen).toBe(false);
    expect(document.getElementById('modalTitle')?.textContent).toBe('');
    expect(document.getElementById('modalContent')?.innerHTML).toBe('');

    modal.open('Again', '<span>content</span>');
    document.getElementById('modalClose')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(modal.isOpen).toBe(false);

    modal.destroy();
  });

  it('closes when the overlay itself is clicked and removes listeners on destroy', () => {
    const modal = new Modal();
    const overlay = document.getElementById('modalOverlay') as HTMLElement;
    const closeBtn = document.getElementById('modalClose') as HTMLElement;

    modal.open('Overlay', '<em>body</em>');
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(modal.isOpen).toBe(false);

    modal.open('Destroy', '<strong>body</strong>');
    modal.destroy();

    closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(modal.isOpen).toBe(false);
  });
});