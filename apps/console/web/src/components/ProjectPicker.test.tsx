import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../hooks/useProjects';
import { ProjectPicker } from './ProjectPicker';

function project(id: string, over: Partial<Project> = {}): Project {
  return {
    id,
    name: id,
    appId: id,
    deployed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Project;
}

function renderPicker(projects: Project[]) {
  return render(
    <ProjectPicker
      projects={projects}
      currentId={null}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
      onDelete={vi.fn()}
      onFreshChat={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('ProjectPicker — design tokens', () => {
  it('uses a translucent scrim with an opaque panel, no inline styles', () => {
    const { container } = renderPicker([]);
    const overlay = screen.getByRole('dialog', { name: 'Project picker' });
    expect(overlay).toHaveClass('z-50', 'bg-scrim');
    expect(container.querySelector('[role="document"]')).toHaveClass('bg-panel', 'border-line');
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('maps session activity to token status classes', () => {
    const { container } = renderPicker([
      project('live', { deployed: true }),
      project('building', { activity: { phase: 'building' } as Project['activity'] }),
      project('failed', { activity: { phase: 'error' } as Project['activity'] }),
      project('draft'),
    ]);
    const dots = [...container.querySelectorAll('span[role="presentation"]')];
    expect(dots.map((d) => d.className)).toEqual([
      expect.stringContaining('bg-success'),
      expect.stringContaining('bg-warning'),
      expect.stringContaining('bg-danger'),
      expect.stringContaining('bg-line-strong'),
    ]);
  });
});
