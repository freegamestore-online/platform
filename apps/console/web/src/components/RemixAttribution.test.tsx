import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RemixAttribution } from './RemixAttribution';

const snapshot = {
  id: 'space-shooter',
  name: 'Space <Shooter>',
  creatorGithub: 'original-creator',
  forkedAt: '2026-09-25T00:00:00.000Z',
};

describe('RemixAttribution', () => {
  afterEach(cleanup);

  it('renders the immutable snapshot with safe live-source and creator links', () => {
    render(<RemixAttribution attribution={snapshot} sourceAvailable />);
    expect(screen.getByText('Space <Shooter>')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Space <Shooter>' }).getAttribute('href')).toBe(
      'https://space-shooter.freegamestore.online',
    );
    const creator = screen.getByRole('link', { name: '@original-creator' });
    expect(creator.getAttribute('href')).toBe('https://github.com/original-creator');
    expect(creator.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps the snapshot readable but unlinked when its source was deleted', () => {
    render(<RemixAttribution attribution={snapshot} sourceAvailable={false} />);
    expect(screen.getByText('Space <Shooter>')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Space <Shooter>' })).toBeNull();
  });

  it('supports an unresolved legacy source id without inventing a creator or link', () => {
    render(<RemixAttribution attribution="deleted-source" />);
    expect(screen.getByText('Remixed from deleted-source')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders nothing for no or malformed attribution', () => {
    const { rerender } = render(<RemixAttribution />);
    expect(screen.queryByText(/Remixed from/)).toBeNull();
    rerender(<RemixAttribution attribution={'javascript:alert(1)'} />);
    expect(screen.queryByText(/Remixed from/)).toBeNull();
  });
});
