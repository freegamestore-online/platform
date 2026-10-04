import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Account deletion (#113): permanent, irreversible cross-service deletion.
// The UI shows a confirmation dialog before calling the endpoint.

const mockSignOut = vi.fn();
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
    signOut: mockSignOut,
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
  vi.clearAllMocks();
});

describe('Profile account deletion', () => {
  it('offers a delete button that shows confirmation on click', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );
    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    expect(deleteButton).toBeTruthy();
    expect(screen.getByText(/permanently delete your account/i)).toBeTruthy();

    fireEvent.click(deleteButton);
    expect(screen.getByText(/are you absolutely sure/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /yes, delete everything/i })).toBeTruthy();
  });

  it('calls /auth/delete when confirmed', () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, cleared: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    fireEvent.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /yes, delete everything/i });
    fireEvent.click(confirmButton);

    expect(fetchMock).toHaveBeenCalledWith('/auth/delete', { method: 'POST' });
  });

  it('attempts to delete when confirmation is confirmed', () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, cleared: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    fireEvent.click(deleteButton);

    const confirmButton = screen.getByRole('button', { name: /yes, delete everything/i });
    fireEvent.click(confirmButton);

    expect(fetchMock).toHaveBeenCalled();
  });

  it('can cancel deletion confirmation', () => {
    vi.stubGlobal('fetch', vi.fn());

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    fireEvent.click(deleteButton);
    expect(screen.getByText(/are you absolutely sure/i)).toBeTruthy();

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    // Confirmation should be gone, delete button should be back
    expect(screen.queryByText(/are you absolutely sure/i)).toBeNull();
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeTruthy();
  });
});
