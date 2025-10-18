import { Abi, type PublicClient } from "viem";

export const VYBE_CONTRACT_ABI: Abi = [
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "question", type: "string", indexed: false },
      { name: "trackId", type: "string", indexed: false },
      { name: "threshold", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "marketCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
  type: "function",
  name: "buyYes",
  stateMutability: "payable",
  inputs: [{ name: "marketId", type: "uint256" }],
  outputs: [],
  },
  {
  type: "function",
  name: "buyNo",
  stateMutability: "payable",
  inputs: [{ name: "marketId", type: "uint256" }],
  outputs: [],
  },
  {
  type: "function",
  name: "redeem",
  stateMutability: "nonpayable",
  inputs: [{ name: "marketId", type: "uint256" }],
  outputs: [],
  },
  {
  type: "function",
  name: "getUserBets",
  stateMutability: "view",
  inputs: [{ name: "_user", type: "address" }],
  outputs: [
    {
      components: [
        { name: "marketId", type: "uint256" },
        { name: "betYes", type: "bool" },
        { name: "amount", type: "uint256" },
        { name: "claimed", type: "bool" },
      ],
      type: "tuple[]",
    },
  ],
  },
  {
    type: "function",
    name: "getMarket",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "question", type: "string" },
      { name: "trackId", type: "string" },
      { name: "threshold", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "resolved", type: "bool" },
      { name: "outcomeYes", type: "bool" },
      { name: "yesPool", type: "uint256" },
      { name: "noPool", type: "uint256" },
    ],
  },
];

// NOTE: We intentionally do not support passing contract addresses via env.
// Configure ONLY deployer EOA(s) and we will discover all deployed Vybe contracts.

// Alternative config: specify deployer EOAs and we’ll discover contracts they created.
// Supports NEXT_PUBLIC_DEPLOYER_ADDRESSES (JSON/CSV) or NEXT_PUBLIC_DEPLOYER_ADDRESS.
export function getConfiguredDeployerAddresses(): (`0x${string}`)[] {
  const multi = process.env.NEXT_PUBLIC_DEPLOYER_ADDRESSES;
  const single = process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS as `0x${string}` | undefined;
  const addrs: (`0x${string}`)[] = [];

  if (multi && multi.trim().length > 0) {
    try {
      const parsed = JSON.parse(multi);
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          if (typeof a === 'string' && a.startsWith('0x')) addrs.push(a as `0x${string}`);
        }
      }
    } catch {
      const parts = multi.split(',').map((s) => s.trim()).filter(Boolean);
      for (const p of parts) if (p.startsWith('0x')) addrs.push(p as `0x${string}`);
    }
  }

  if (addrs.length === 0 && single) addrs.push(single);
  return addrs;
}

// Discover VybePredictionMarket contract addresses by scanning blocks for contract creations
// from the configured deployer EOAs. On local Hardhat this is fast; for larger chains, set
// NEXT_PUBLIC_SCAN_START_BLOCK or NEXT_PUBLIC_SCAN_BLOCKS to bound scanning.
export async function discoverVybeContractsFromDeployers(
  client: PublicClient,
  opts?: { startBlock?: bigint; maxBlocks?: number }
): Promise<(`0x${string}`)[]> {
  const latest = await client.getBlockNumber();
  const envStart = process.env.NEXT_PUBLIC_SCAN_START_BLOCK;
  const envMax = process.env.NEXT_PUBLIC_SCAN_BLOCKS;
  const maxBlocks = opts?.maxBlocks ?? (envMax ? Number(envMax) : 2000);
  let startBlock: bigint;
  if (opts?.startBlock !== undefined) startBlock = opts.startBlock;
  else if (envStart && envStart.trim()) startBlock = BigInt(envStart);
  else startBlock = latest > BigInt(maxBlocks) ? (latest - BigInt(maxBlocks)) : BigInt(0);
  const found = new Set<`0x${string}`>();

  // 1) Prefer log-based discovery (much cheaper): query MarketCreated logs across range.
  try {
    const logs = await client.getLogs({
      fromBlock: startBlock,
      toBlock: latest,
      event: VYBE_CONTRACT_ABI.find((e: any) => e.type === 'event' && e.name === 'MarketCreated') as any,
      // address omitted so we capture from all Vybe deployments in the range
    });
    for (const log of logs) {
      const addr = log.address as `0x${string}`;
      try {
        // Verify a simple read to ensure it's the correct contract ABI
        await client.readContract({ address: addr, abi: VYBE_CONTRACT_ABI, functionName: 'marketCount', args: [] });
        found.add(addr);
      } catch {
        // ignore non-matching addresses
      }
    }
    if (found.size > 0) return Array.from(found);
  } catch {
    // ignore and fall back
  }

  // 2) Fallback: scan deployer-created contract addresses (heavier, but works locally)
  const deployers = new Set(getConfiguredDeployerAddresses().map((a) => a.toLowerCase()));
  if (deployers.size === 0) return [];

  for (let bn = startBlock; bn <= latest; bn = bn + BigInt(1)) {
    const block = await client.getBlock({ blockNumber: bn, includeTransactions: true });
    const txs = block.transactions as any[];
    for (const tx of txs) {
      const toNull = !tx.to || tx.to === null;
      const from = (tx.from as string | undefined)?.toLowerCase();
      if (!toNull || !from || !deployers.has(from)) continue;
      try {
        const receipt = await client.getTransactionReceipt({ hash: tx.hash });
        const addr = receipt.contractAddress as `0x${string}` | null;
        if (!addr) continue;
        const code = await client.getBytecode({ address: addr });
        if (!code || code === '0x') continue;
        await client.readContract({ address: addr, abi: VYBE_CONTRACT_ABI, functionName: 'marketCount', args: [] });
        found.add(addr);
      } catch {
        // ignore non-matching contracts or read failures
      }
    }
  }

  return Array.from(found);
}
