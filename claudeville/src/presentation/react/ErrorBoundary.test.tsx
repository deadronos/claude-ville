/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ErrorBoundary } from './ErrorBoundary.js';

function BrokenChild() {
  throw new Error('render exploded');
  return null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders a fallback when a child throws during render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('RENDER FAILED')).toBeInTheDocument();
    expect(screen.getByText('render exploded')).toBeInTheDocument();
  });
});
