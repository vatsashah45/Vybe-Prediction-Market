"use client";

import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import { useMarkets } from "@/hooks/useMarkets";
import { useMemo, useRef } from "react";

type MarketTuple = [
  string,   // question
  string,   // trackId
  bigint,   // threshold
  bigint,   // deadline
  boolean,  // resolved
  boolean,  // outcomeYes
  bigint,   // yesPool
  bigint    // noPool
];

interface Market {
  id: number;
  question: string;
  trackId: string;
  threshold: number;
  deadline: number;
  resolved: boolean;
  outcomeYes: boolean;
  yesPool: number;
  noPool: number;
}

export default function ExplorePage() {
  const { markets, loading, error } = useMarkets();
  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  // Static timestamp per mount (no live countdown)
  const nowSecRef = useRef(Math.floor(Date.now() / 1000));
  const nowSec = nowSecRef.current;

  const formatRemaining = (seconds: number) => {
    if (seconds <= 0) return "0s";
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

  const sortedMarkets = useMemo(() => {
    if (!markets) return [] as typeof markets;
    const arr = [...markets];
    arr.sort((a, b) => {
      const aClosed = a.resolved || a.deadline <= nowSec;
      const bClosed = b.resolved || b.deadline <= nowSec;
      if (aClosed !== bClosed) return aClosed ? 1 : -1; // open first
      // then sort by soonest deadline
      return a.deadline - b.deadline;
    });
    return arr;
  }, [markets, nowSec]);

  return (
    <div className="px-4 py-8 max-w-6xl mx-auto space-y-6">
      <h1 className="h1 mb-4">Explore Events</h1>
      <SearchBar placeholder="Search for artists, tracks, or markets..." onSearch={() => { }} />

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}
      {(!sortedMarkets || sortedMarkets.length === 0) && !loading ? (
        <p className="muted mt-4">No markets found.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedMarkets.map((market) => {
            const isClosed = market.resolved || market.deadline <= nowSec;
            const content = (
              <div className="card-body">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="h2 mb-2">{market.question}</h2>
                  {isClosed && (
                    <span className="inline-flex items-center rounded-full bg-white/10 text-white/70 text-[10px] px-2 py-0.5">
                      Closed
                    </span>
                  )}
                </div>
                <p className="muted text-xs mb-1">Market #{market.marketId} · {shortAddr(market.contractAddress)}</p>
                <p className="muted text-sm mb-1">Track ID: {market.trackId}</p>
                {!isClosed && (
                  <p className="text-xs text-white/70 mt-1">Ends in {formatRemaining(market.deadline - nowSec)}</p>
                )}
              </div>
            );

            return isClosed ? (
              <div
                key={`${market.contractAddress}-${market.marketId}`}
                className={`card transition block focus:outline-none rounded-xl opacity-60 border-white/5 cursor-not-allowed`}
                aria-disabled
                tabIndex={-1}
                title={market.contractAddress}
              >
                {content}
              </div>
            ) : (
              <Link
                key={`${market.contractAddress}-${market.marketId}`}
                href={`/event?address=${market.contractAddress}&id=${market.marketId}`}
                className={`card transition block focus:outline-none rounded-xl hover:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]`}
                title={market.contractAddress}
              >
                {content}
              </Link>
            );
          })}

        </div>
      )}
    </div>
  );
}
