import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { poolAbi } from '../abis/poolAbi';
import type { UserPoolPosition } from '../types';

interface UseUserPoolPositionResult {
  position: UserPoolPosition | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetches the connected user's position in a given pool.
 *
 * The effect is parameterized by `address` and `poolAddress`. When either
 * changes, the previous in-flight request is aborted via `AbortController`
 * and its late-arriving response is ignored, so a stale response can never
 * clobber fresher state (e.g. rapid wallet switching).
 */
export function useUserPoolPosition(
  address: Address | undefined,
  poolAddress: Address | undefined,
): UseUserPoolPositionResult {
  const publicClient = usePublicClient();
  const [position, setPosition] = useState<UserPoolPosition | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address || !poolAddress || !publicClient) {
      setPosition(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const result = await publicClient.readContract({
          address: poolAddress,
          abi: poolAbi,
          functionName: 'getUserPosition',
          args: [address],
        });

        // Ignore stale responses: the effect was cleaned up (parameter
        // changed or component unmounted) while this request was in flight.
        if (cancelled || controller.signal.aborted) return;

        setPosition(result as UserPoolPosition);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address, poolAddress, publicClient]);

  return { position, isLoading, error };
}
