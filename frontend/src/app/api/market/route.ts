// src/app/api/market/route.ts
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base, localhost } from "viem/chains";
import { VYBE_CONTRACT_ABI, discoverVybeContractsFromDeployers } from "@/lib/contract";

const client = createPublicClient({
  chain: localhost, // or mainnet depending on your deploy
  transport: http(process.env.NEXT_PUBLIC_RPC_URL),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  const addressParam = searchParams.get('address');
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  let address = addressParam as `0x${string}` | null;
  if (!address || !address.startsWith('0x')) {
    // Try discovery via configured deployer(s)
    const discovered = await discoverVybeContractsFromDeployers(client as any);
    if (!discovered || discovered.length === 0) {
      return NextResponse.json({ error: "No contract address provided and none discoverable. Set NEXT_PUBLIC_DEPLOYER_ADDRESS[ES] or pass ?address=0x..." }, { status: 400 });
    }
    if (discovered.length > 1) {
      return NextResponse.json({ error: `Multiple Vybe contracts discovered (${discovered.length}). Pass ?address=0x... to disambiguate.` }, { status: 400 });
    }
    address = discovered[0];
  }

  const [
    question,
    trackId,
    threshold,
    deadline,
    resolved,
    outcomeYes,
    yesPool,
    noPool,
  ] = await client.readContract({
  address: address as `0x${string}`,
    abi: VYBE_CONTRACT_ABI,
    functionName: "getMarket",
    args: [BigInt(id)],
  }) as [
    string, // question
    string, // trackId
    bigint, // threshold
    bigint, // deadline
    boolean, // resolved
    boolean, // outcomeYes
    bigint, // yesPool
    bigint  // noPool
  ];

  return NextResponse.json({
    id,
    question,
    trackId,
    threshold: Number(threshold),
    deadline: Number(deadline),
    resolved,
    outcomeYes,
    yesPool: Number(yesPool),
    noPool: Number(noPool),
  });
}