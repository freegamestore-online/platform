import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Regression for #77: the Profile "Delete my account" button promised permanent
// deletion of all data while the endpoint deleted nothing. It must not offer a
// deletion that does not happen.

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      github: 'octo',
      avatarUrl: '',
      githubId: 1,
      sub: 'github:1',
      name: null,
      email: null,
      createdAt: null,
    },
    creator: null,
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock('../hooks/useUsage', () => ({ useUsage: () => ({ totals: null, games: [] }) }));
vi.mock('../components/AISettings', () => ({ AISettings: () => null }));
vi.mock('../components/KidModeSetting', () => ({ KidModeSetting: () => null }));
vi.mock('../components/TextSizeSetting', () => ({ TextSizeSetting: () => null }));
vi.mock('../components/Nav', () => ({ Nav: () => null }));

import { Profile } from './Profile';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Profile account deletion', () => {
  it('does not offer a delete button or promise that data will be removed', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /delete my account/i })).toBeNull();
    expect(screen.queryByText(/permanently delete your account/i)).toBeNull();
    expect(screen.getByText(/self-service account deletion isn't available yet/i)).toBeTruthy();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/auth/delete'))).toBe(false);
  });
});
