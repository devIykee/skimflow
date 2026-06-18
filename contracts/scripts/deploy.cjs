/* eslint-disable no-console */
const hre = require("hardhat");
const { assertTestnet } = require("./_testnet-guard.cjs");

/**
 * Deploys RevenueSplit to Arc TESTNET.
 *
 *   constructor(usdc, platform, owner)
 *     usdc     — USDC_ADDRESS         (Arc testnet USDC, 6 decimals)
 *     platform — PLATFORM_ADDRESS     (treasury that gets the 12% fee)
 *     owner    — OWNER_ADDRESS        (defaults to the deployer; can drain reserve)
 *
 * Creator + referrer are passed PER CALL to split(creator, referrer, amount),
 * so they are intentionally NOT constructor args.
 */
async function main() {
  await assertTestnet(hre);

  const usdc = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
  const platform = process.env.PLATFORM_ADDRESS;
  if (!platform || !/^0x[0-9a-fA-F]{40}$/.test(platform)) {
    throw new Error("Set PLATFORM_ADDRESS (a wallet you control) in ../.env before deploying.");
  }

  const [deployer] = await hre.ethers.getSigners();
  const owner = process.env.OWNER_ADDRESS || deployer.address;

  console.log("Deploying RevenueSplit to Arc testnet…");
  console.log("  deployer:", deployer.address);
  console.log("  usdc:    ", usdc);
  console.log("  platform:", platform);
  console.log("  owner:   ", owner);

  const Factory = await hre.ethers.getContractFactory("RevenueSplit");
  const contract = await Factory.deploy(usdc, platform, owner);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();

  console.log("\n✅ REVENUE_SPLIT_ADDRESS=" + addr + "\n");

  // ── Ready-to-paste env block ───────────────────────────────────────────────
  console.log("# ── Revenue split contract ─────────────────────────────────────────────\n");
  console.log("REVENUE_SPLIT_ADDRESS=" + addr);
  console.log("# The RevenueSplit contract you just deployed. Never change this unless");
  console.log("# you redeploy — all chunk payments route through here.\n");
  console.log("CREATOR_PAYOUT_ADDRESS=");
  console.log("# Do not set this as a fixed env value. Creator payout addresses are");
  console.log("# stored per creator in your database at signup and passed dynamically");
  console.log("# as the first argument when calling RevenueSplit.split(creatorAddress,");
  console.log("# referrerAddress, amount) at payment time. Every creator gets paid");
  console.log("# directly to their own wallet — no pooling, no manual forwarding.\n");
  console.log("PLATFORM_ADDRESS=" + platform);
  console.log("# The wallet that receives the 12% platform fee on every sale.");
  console.log("# In production this should be your treasury wallet. For testnet,");
  console.log("# any wallet you control works fine.\n");
  console.log("REFERRER_ADDRESS=");
  console.log("# Do not set this as a fixed env value. Like creator addresses, referrer");
  console.log("# addresses are resolved per sale from your referral tracking logic and");
  console.log("# passed dynamically as the second argument to RevenueSplit.split().");
  console.log("# Pass address(0) when no referrer exists — the contract will");
  console.log("# automatically add that 5% to the reserve instead.\n");
  console.log("ARC_RPC_URL=https://rpc.testnet.arc.network");
  console.log("# Arc Testnet RPC. Do not change for testnet builds.\n");
  console.log("ARC_CHAIN_ID=5042002");
  console.log("# Arc Testnet chain ID. Do not change for testnet builds.\n");
  console.log("ARC_NETWORK_CAIP2=eip155:5042002");
  console.log("# CAIP-2 identifier for Arc Testnet. Used by Circle SDK adapters.\n");
  console.log("USDC_ADDRESS=0x3600000000000000000000000000000000000000");
  console.log("# Arc Testnet USDC ERC-20 interface, 6 decimals. Do not change.\n");

  // ── Best-effort explorer verification (never fails the deploy) ──────────────
  try {
    console.log("Attempting source verification on arcscan…");
    await hre.run("verify:verify", { address: addr, constructorArguments: [usdc, platform, owner] });
    console.log("✓ Verified.");
  } catch (e) {
    console.log("⚠ Verification skipped/failed (non-fatal):", (e.message || String(e)).split("\n")[0]);
    console.log("  Verify later at https://testnet.arcscan.app once an explorer API is configured.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
