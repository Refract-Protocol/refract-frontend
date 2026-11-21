import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotificationCenter from './NotificationCenter';
import { useNotifications } from '../hooks/useNotifications';

vi.mock('../hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}));

const mockedUseNotifications = vi.mocked(useNotifications);

function buildQuery(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the error state when the notifications query fails', () => {
    mockedUseNotifications.mockReturnValue(
      buildQuery({ isError: true }) as unknown as ReturnType<typeof useNotifications>,
    );

    render(<NotificationCenter />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('calls refetch when the retry action is clicked', () => {
    const refetch = vi.fn();
    mockedUseNotifications.mockReturnValue(
      buildQuery({ isError: true, refetch }) as unknown as ReturnType<typeof useNotifications>,
    );

    render(<NotificationCenter />);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when the query succeeds with zero items', () => {
    mockedUseNotifications.mockReturnValue(
      buildQuery({ data: [] }) as unknown as ReturnType<typeof useNotifications>,
    );

    render(<NotificationCenter />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
