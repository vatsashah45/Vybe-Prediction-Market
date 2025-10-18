'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { formatEther } from 'viem';
import { VYBE_CONTRACT_ABI, discoverVybeContractsFromDeployers } from '@/lib/contract';

interface Bet {
  contractAddress: `0x${string}`;
  marketId: number;
  betYes: boolean;
  amount: bigint;
  claimed: boolean;
  question?: string;
  deadline?: number;
  resolved?: boolean;
}

export default function DashboardPage() {
  const { address } = useAccount();
  const client = usePublicClient();
  const [bets, setBets] = useState<Bet[]>([]);
  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  // Static timestamp per mount (no live countdown)
  const nowSecRef = useRef(Math.floor(Date.now() / 1000));
  const nowSec = nowSecRef.current;

  const formatRemaining = (seconds: number) => {
    if (seconds <= 0) return '0s';
    const d = Math.floor(seconds / 86400);
    seconds %= 86400;
    const h = Math.floor(seconds / 3600);
    seconds %= 3600;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const sortedBets = useMemo(() => {
    const arr = [...bets];
    arr.sort((a, b) => {
      const aClosed = (a.resolved === true) || (typeof a.deadline === 'number' && a.deadline <= nowSec);
      const bClosed = (b.resolved === true) || (typeof b.deadline === 'number' && b.deadline <= nowSec);
      if (aClosed !== bClosed) return aClosed ? 1 : -1; // open first
      // then sort by sooner deadline (undefined to bottom)
      const ad = typeof a.deadline === 'number' ? a.deadline : Number.MAX_SAFE_INTEGER;
      const bd = typeof b.deadline === 'number' ? b.deadline : Number.MAX_SAFE_INTEGER;
      return ad - bd;
    });
    return arr;
  }, [bets, nowSec]);

  useEffect(() => {
    if (!client || !address) return;

    const loadBets = async () => {
      try {
        const addrs = await discoverVybeContractsFromDeployers(client);
        const all: Bet[] = [];
        for (const addr of addrs) {
          const bytecode = await client.getBytecode({ address: addr });
          if (!bytecode || bytecode === '0x') continue;
          const result = await client.readContract({
            address: addr,
            abi: VYBE_CONTRACT_ABI,
            functionName: 'getUserBets',
            args: [address],
          });

          const rows = result as any[];
          if (!rows || rows.length === 0) continue;

          // Fetch market questions in parallel for this contract
          const ids = rows.map((b) => Number(b.marketId));
          const marketReads = ids.map((id) =>
            client.readContract({
              address: addr,
              abi: VYBE_CONTRACT_ABI,
              functionName: 'getMarket',
              args: [BigInt(id)],
            }) as Promise<[
              string, string, bigint, bigint, boolean, boolean, bigint, bigint
            ]>
          );
          const marketResults = await Promise.allSettled(marketReads);

          for (let i = 0; i < rows.length; i++) {
            const b = rows[i];
            const mr = marketResults[i];
            const question = mr.status === 'fulfilled' ? mr.value[0] : undefined;
            const deadline = mr.status === 'fulfilled' ? Number(mr.value[3]) : undefined;
            const resolved = mr.status === 'fulfilled' ? Boolean(mr.value[4]) : undefined;
            all.push({
              contractAddress: addr,
              marketId: Number(b.marketId),
              betYes: b.betYes,
              amount: b.amount as bigint,
              claimed: b.claimed,
              question,
              deadline,
              resolved,
            });
          }
        }
        setBets(all);
      } catch (err) {
        console.error('Error loading bets:', err);
      }
    };

    loadBets();
  }, [client, address]);

  return (
    <div className="mx-auto max-w-6xl px-4 space-y-6">
      <section className="card">
        <div className="card-body">
          <h1 className="h2">Dashboard</h1>
          <p className="mt-1 muted">
            Your active and past bets.
          </p>
        </div>
      </section>

      {sortedBets.length === 0 ? (
        <p className="muted">No bets found.</p>
      ) : (
        <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedBets.map((bet) => {
            const isClosed = (bet.resolved === true) || (typeof bet.deadline === 'number' && bet.deadline <= nowSec);
            const content = (
              <>
                <div className="font-medium">{bet.question || `Market #${bet.marketId}`}</div>
                <div className="text-[10px] text-white/40 flex items-center gap-2">Market #{bet.marketId} · {shortAddr(bet.contractAddress)} {isClosed && <span className="inline-flex items-center rounded-full bg-white/10 text-white/70 text-[10px] px-2 py-0.5">Closed</span>}</div>
                <div className="mt-1">
                  <span className={bet.betYes ? "text-green-400" : "text-red-400"}>
                    {bet.betYes ? "Yes" : "No"}
                  </span>{" "}
                  bet of {formatEther(bet.amount)} ETH
                </div>
                {!isClosed && typeof bet.deadline === 'number' && (
                  <div className="text-xs text-white/70 mt-1">Ends in {formatRemaining(bet.deadline - nowSec)}</div>
                )}
                {bet.claimed && (
                  <div className="text-xs text-green-500 mt-1">✅ Claimed</div>
                )}
              </>
            );

            return isClosed ? (
              <div
                key={`${bet.contractAddress}-${bet.marketId}`}
                className={`rounded-xl border border-white/10 p-4 bg-white/5 block opacity-60 cursor-not-allowed`}
                aria-disabled
                tabIndex={-1}
                title={bet.contractAddress}
              >
                {content}
              </div>
            ) : (
              <a
                key={`${bet.contractAddress}-${bet.marketId}`}
                href={`/event?address=${bet.contractAddress}&id=${bet.marketId}`}
                className={`rounded-xl border border-white/10 p-4 bg-white/5 block hover:border-[var(--brand)]`}
                title={bet.contractAddress}
              >
                {content}
              </a>
            );
          })}
        </section>
      )}
    </div>
  );
}
