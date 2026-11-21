import { resolveFederationAddress, clearFederationCache } from '../federation';

describe('resolveFederationAddress', () => {
  beforeEach(() => {
    clearFederationCache();
    jest.restoreAllMocks();
  });

  it('caches resolved addresses so repeated lookups only hit the network once', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ account_id: 'GABCDEF1234567890' }),
    } as any);

    const first = await resolveFederationAddress('alice*example.com');
    const second = await resolveFederationAddress('alice*example.com');

    expect(first).toBe('GABCDEF1234567890');
    expect(second).toBe('GABCDEF1234567890');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the cache when clearFederationCache is called', async () => {
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ account_id: 'GABCDEF1234567890' }),
    } as any);

    await resolveFederationAddress('alice*example.com');
    clearFederationCache();
    await resolveFederationAddress('alice*example.com');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
