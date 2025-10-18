'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { VYBE_CONTRACT_ABI, discoverVybeContractsFromDeployers } from '@/lib/contract';

export type RawMarketTuple = [
  string,
  string,
  bigint,
  bigint,
  boolean,
  boolean,
  bigint,
  bigint,
];

export interface MarketSummary {
  contractAddress: `0x${string}`;
  marketId: number;
  question: string;
  trackId: string;
  threshold: number;
  deadline: number;
  resolved: boolean;
  outcomeYes: boolean;
  yesPool: bigint;
  noPool: bigint;
}

export function useMarkets(pollMs: number = 15000) {
  const client = usePublicClient();
  const [addresses, setAddresses] = useState<`0x${string}`[]>([]);
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Discover contracts from deployer EOAs.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const discover = async () => {
      try {
        const found = await discoverVybeContractsFromDeployers(client);
        if (!cancelled && found.length > 0) setAddresses(found);
      } catch {
        // ignore
      }
    };
    discover();
    return () => { cancelled = true; };
  }, [client, addresses.length]);

  useEffect(() => {
    if (!client || addresses.length === 0) return;

    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const all: MarketSummary[] = [];
        for (const addr of addresses) {
          // Check code exists
          const bytecode = await client.getBytecode({ address: addr });
          if (!bytecode || bytecode === '0x') continue;

          const mc = await client.readContract({
            address: addr,
            abi: VYBE_CONTRACT_ABI,
            functionName: 'marketCount',
            args: [],
          }) as bigint;
          const total = Number(mc);
          if (total === 0) continue;

          const reads = Array.from({ length: total }, (_, i) =>
            client.readContract({
              address: addr,
              abi: VYBE_CONTRACT_ABI,
              functionName: 'getMarket',
              args: [BigInt(i + 1)],
            }) as Promise<RawMarketTuple>
          );

          const results = await Promise.all(reads);
          for (let i = 0; i < results.length; i++) {
            const [question, trackId, threshold, deadline, resolved, outcomeYes, yesPool, noPool] = results[i];
            all.push({
              contractAddress: addr,
              marketId: i + 1,
              question,
              trackId,
              threshold: Number(threshold),
              deadline: Number(deadline),
              resolved,
              outcomeYes,
              yesPool: yesPool,
              noPool: noPool,
            });
          }
        }
        if (!cancelled) setMarkets(all);
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message ?? 'Failed to load markets');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
  run();

    let timer: ReturnType<typeof setInterval> | undefined;
    if (pollMs > 0) {
      timer = setInterval(() => {
        if (!cancelled) run();
      }, pollMs);
    }

    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [client, addresses.join(','), pollMs, version]);

  const refresh = () => setVersion((v) => v + 1);
  return { markets, loading, error, refresh };
}
