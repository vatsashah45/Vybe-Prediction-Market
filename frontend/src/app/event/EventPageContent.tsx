
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { VYBE_CONTRACT_ABI, discoverVybeContractsFromDeployers } from '@/lib/contract';

interface Market {
  id: number;
  question: string;
  trackId: string;
  threshold: number;
  deadline: number;
  resolved: boolean;
  outcomeYes: boolean;
  yesPool: bigint;
  noPool: bigint;
}

type MarketTuple = [
  string,
  string,
  bigint,
  bigint,
  boolean,
  boolean,
  bigint,
  bigint
];

export default function EventPage() {
  const search = useSearchParams();
  const id = Number(search.get('id') ?? 1);
  const fromUrl = search.get('address') as `0x${string}` | null;
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { address: connectedAddress, isConnected } = useAccount();

  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addr, setAddr] = useState<`0x${string}` | null>(fromUrl && fromUrl.startsWith('0x') ? fromUrl : null);

  // If no address from URL or env, try to discover from configured deployers
  useEffect(() => {
    if (addr || !client) return;
    let cancelled = false;
    const run = async () => {
      try {
        const discovered = await discoverVybeContractsFromDeployers(client);
        if (!cancelled && discovered.length > 0) {
          // pick the most recent (last) discovered contract
          setAddr(discovered[discovered.length - 1]);
        }
      } catch {
        // ignore
      }
    };
    run();
    return () => { cancelled = true; };
  }, [addr, client]);

  useEffect(() => {
    if (!client) return;

    const fetchMarket = async () => {
      try {
        setError(null);
        // Preflight checks to avoid `returned no data (0x)`
        if (!addr) {
          setError('Contract address not set or discoverable. Provide NEXT_PUBLIC_DEPLOYER_ADDRESS[ES], or open this page with ?address=0x...');
          return;
        }

        const chainId = await client.getChainId();
        console.log('[Event] chainId=', chainId, 'address=', addr, 'marketId=', id);

        const bytecode = await client.getBytecode({ address: addr });
        if (!bytecode || bytecode === '0x') {
          setError(`No contract code found at ${addr}. Is the node fresh and was the contract deployed to this chain?`);
          return;
        }

        const mc = await client.readContract({
          address: addr,
          abi: VYBE_CONTRACT_ABI,
          functionName: 'marketCount',
          args: [],
        }) as bigint;
        if (mc === BigInt(0)) {
          setError('No markets exist yet. Run the deploy script to create a demo market.');
          return;
        }
        if (BigInt(id) > mc) {
          setError(`Market ${id} does not exist (marketCount=${mc}).`);
          return;
        }

        const result = await client.readContract({
          address: addr,
          abi: VYBE_CONTRACT_ABI,
          functionName: 'getMarket',
          args: [BigInt(id)],
        }) as MarketTuple;

        const [
          question,
          trackId,
          threshold,
          deadline,
          resolved,
          outcomeYes,
          yesPool,
          noPool,
        ] = result;

        setMarket({
          id,
          question,
          trackId,
          threshold: Number(threshold),
          deadline: Number(deadline),
          resolved,
          outcomeYes,
          yesPool: yesPool,
          noPool: noPool,
        });
      } catch (err) {
        console.error('Error fetching market:', err);
        setError((err as Error)?.message ?? 'Failed to fetch market');
      }
    };

    fetchMarket();
  }, [client, id, addr]);

  const handleBet = async (betYes: boolean) => {
  try {
    setLoading(true);
    setError(null);

    if (!isConnected || !connectedAddress) {
      setError('Connect your wallet to place a bet.');
      return;
    }
    if (!client) {
      setError('RPC client not ready.');
      return;
    }

    const functionName = betYes ? 'buyYes' : 'buyNo';
    // Simulate first to surface precise revert reasons and ensure correct account/chain/value
    if (!addr) {
      setError('Contract address unavailable.');
      return;
    }
    const sim = await client.simulateContract({
      address: addr as `0x${string}`,
      abi: VYBE_CONTRACT_ABI,
      functionName,
      args: [BigInt(id)],
      account: connectedAddress,
      value: parseEther('0.1'),
    });

    const tx = await writeContractAsync({
      ...sim.request,
    });

    console.log('Bet placed tx hash:', tx);
  } catch (err) {
    console.error('Bet failed:', err);
    setError((err as Error)?.message ?? 'Bet transaction failed');
  } finally {
    setLoading(false);
  }
  };

  const handleRedeem = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!isConnected || !connectedAddress) {
        setError('Connect your wallet to redeem.');
        return;
      }
      if (!client) {
        setError('RPC client not ready.');
        return;
      }
      if (!addr) {
        setError('Contract address unavailable.');
        return;
      }
      const sim = await client.simulateContract({
        address: addr as `0x${string}`,
        abi: VYBE_CONTRACT_ABI,
        functionName: 'redeem',
        args: [BigInt(id)],
        account: connectedAddress,
      });
      const tx = await writeContractAsync({ ...sim.request });
      console.log('Redeem tx:', tx);
    } catch (err) {
      console.error('Redeem failed:', err);
      setError((err as Error)?.message ?? 'Redeem failed');
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">
          <div className="font-semibold text-red-400">Unable to load market</div>
          <div className="mt-1 text-red-300 whitespace-pre-wrap">{error}</div>
          <div className="mt-2 text-red-300/80">
            Tips:
            <ul className="list-disc list-inside">
              <li>Ensure Hardhat node is running on {process.env.NEXT_PUBLIC_RPC_URL || 'http://127.0.0.1:8545'}</li>
              <li>If no address is in the URL, set NEXT_PUBLIC_DEPLOYER_ADDRESS[ES] so the app can discover deployments</li>
              <li>Refresh the app after redeploying the node or contracts to clear stale client cache</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  if (!market) return <p className="p-8 text-center">Loading market...</p>;

  const nowSec = Math.floor(Date.now() / 1000);
  const isClosed = market.resolved || market.deadline <= nowSec;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <section className="card">
        <div className="card-body">
          <div className="text-sm muted flex items-center gap-2">
            <span>Market #{id}</span>
            {isClosed && (
              <span className="inline-flex items-center rounded-full bg-white/10 text-white/70 text-[10px] px-2 py-0.5">Closed</span>
            )}
          </div>
          <h1 className="h2 mt-1">{market.question}</h1>
          <p className="mt-2 muted">Track ID: {market.trackId}</p>
          {addr && (
            <p className="mt-1 text-xs text-white/40 break-all">Contract: {addr}</p>
          )}

          <div className="mt-4 text-sm">
            <div>Yes Pool: {formatEther(market.yesPool)} ETH</div>
            <div>No Pool: {formatEther(market.noPool)} ETH</div>
          </div>

          <div className="mt-6 grid sm:grid-cols-2 gap-4">
            <button
              onClick={() => handleBet(true)}
              disabled={loading || isClosed}
              className="btn btn-primary rounded-full"
            >
              {loading ? 'Processing...' : (isClosed ? 'Betting closed' : 'Bet Yes (0.1 ETH)')}
            </button>
            <button
              onClick={() => handleBet(false)}
              disabled={loading || isClosed}
              className="btn btn-ghost rounded-full"
            >
              {loading ? 'Processing...' : (isClosed ? 'Betting closed' : 'Bet No (0.1 ETH)')}
            </button>
            <button
              onClick={handleRedeem}
              disabled={loading}
              className="btn btn-outline rounded-full"
            >
              {loading ? 'Processing...' : 'Redeem'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}