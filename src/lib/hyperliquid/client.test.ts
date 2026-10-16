import { afterEach, describe, expect, it, vi } from 'vitest';
import { HyperliquidError, postInfo } from './client.ts';

const ok = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postInfo', () => {
  it('returns validated payloads without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([1, 2]));
    vi.stubGlobal('fetch', fetchMock);
    const result = await postInfo({ type: 'x' }, isArray, { baseDelayMs: 1 });
    expect(result).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries rate limits and then succeeds', async () => {
    const limited = new Response('slow down', { status: 429 });
    const fetchMock = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(ok([]));
    vi.stubGlobal('fetch', fetchMock);
    const result = await postInfo({ type: 'x' }, isArray, { baseDelayMs: 1 });
    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and surfaces rate-limited (never empty success)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('slow', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postInfo({ type: 'x' }, isArray, { maxRetries: 1, baseDelayMs: 1 })).rejects.toThrow(
      HyperliquidError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postInfo({ type: 'x' }, isArray, { baseDelayMs: 1 })).rejects.toThrow(
      HyperliquidError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid response shapes without a fallback value', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ not: 'an-array' }));
    vi.stubGlobal('fetch', fetchMock);
    const err = await postInfo({ type: 'x' }, isArray, { baseDelayMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(HyperliquidError);
    expect((err as HyperliquidError).kind).toBe('invalid-response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects non-JSON bodies as invalid responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('not json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(postInfo({ type: 'x' }, isArray, { baseDelayMs: 1 })).rejects.toThrow(
      HyperliquidError,
    );
  });
});
