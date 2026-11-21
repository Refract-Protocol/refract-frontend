import React from 'react';
import { render, screen } from '@testing-library/react';
import PoolActivityFeed from '../PoolActivityFeed';

describe('PoolActivityFeed memoization', () => {
  it('does not re-render when props are referentially equal', () => {
    const activities = [
      { id: '1', type: 'deposit', amount: 100, timestamp: 1700000000 },
    ];

    const renderSpy = jest.fn();

    const Wrapper = ({ tick }: { tick: number }) => {
      renderSpy();
      return (
        <div data-testid="tick">{tick}</div>
      );
    };

    const { rerender } = render(
      <>
        <PoolActivityFeed activities={activities} />
        <Wrapper tick={0} />
      </>
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Re-render parent with unrelated state change but same props for the feed.
    rerender(
      <>
        <PoolActivityFeed activities={activities} />
        <Wrapper tick={1} />
      </>
    );

    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tick')).toHaveTextContent('1');
  });

  it('renders activity items', () => {
    const activities = [
      { id: '1', type: 'deposit', amount: 100, timestamp: 1700000000 },
    ];

    render(<PoolActivityFeed activities={activities} />);

    expect(screen.getByText(/deposit/i)).toBeInTheDocument();
  });
});
