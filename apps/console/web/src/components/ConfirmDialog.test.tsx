import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders when open is true', () => {
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    // Find the most recently rendered dialog in this container
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Never visible"
        message="This should not appear"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
    expect(screen.queryByText('Never visible')).not.toBeInTheDocument();
    expect(screen.queryByText('This should not appear')).not.toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        confirmText="Delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        cancelText="Cancel"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    const backdrops = container.querySelectorAll('[role="presentation"]');
    const backdrop = backdrops[backdrops.length - 1] as HTMLElement;
    fireEvent.click(backdrop);

    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when close button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    const closeButton = screen.getByLabelText('Close dialog');
    fireEvent.click(closeButton);

    expect(onCancel).toHaveBeenCalled();
  });

  it('does not close dialog when content is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    const dialogs = screen.getAllByRole('dialog');
    const dialog = dialogs[dialogs.length - 1]!;
    fireEvent.click(dialog);

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('uses custom button text', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm action"
        message="Proceed?"
        confirmText="Yes, proceed"
        cancelText="No, cancel"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Yes, proceed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No, cancel' })).toBeInTheDocument();
  });

  it('applies danger variant to confirm button when isDangerous is true', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        isDangerous={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmButton).toHaveClass('bg-[#ef4444]');
  });

  it('has proper ARIA attributes', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete?"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const dialogs = screen.getAllByRole('dialog');
    const dialog = dialogs[dialogs.length - 1];
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'dialog-title');
    expect(screen.getByText('Delete?')).toHaveAttribute('id', 'dialog-title');
  });
});
