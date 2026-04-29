/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';

import { PostProcessing } from './PostProcessing';
import { render } from '@testing-library/react';

describe('PostProcessing', () => {
  it('renders nothing while effects are deferred', () => {
    const { container } = render(<PostProcessing />);

    expect(container).toBeEmptyDOMElement();
  });
});
