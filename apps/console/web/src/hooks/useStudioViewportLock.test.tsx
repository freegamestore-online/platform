import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStudioViewportLock } from './useStudioViewportLock';

function Lock() {
  useStudioViewportLock();
  return null;
}

describe('useStudioViewportLock', () => {
  it('locks the document and restores its former overflow values on unmount', () => {
    document.body.style.overflow = 'auto';
    document.documentElement.style.overflow = 'scroll';
    const view = render(<Lock />);

    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    view.unmount();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.documentElement.style.overflow).toBe('scroll');
  });
});
