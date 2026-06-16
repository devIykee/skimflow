/* eslint-disable no-console */
const hre = require("hardhat");
const { assertTestnet } = require("./_testnet-guard.cjs");

/**
 * Deploys AgentMarketplace to Circle Arc testnet (or any EVM network).
 *
 *   USDC_ADDRESS=0x... npm run deploy:marketplace
 *
 * After deploy, copy the printed address into:
 *   apps/web/.env.local →  NEXT_PUBLIC_MARKETPLACE_ADDRESS=0x...
 *
 * Optionally, if you don't have a real USDC on your target network, deploy the
 * bundled MockUSDC first (see scripts/deploy-mock-usdc.cjs) and pass its address.
 */
async function main() {
  const usdc = process.env.USDC_ADDRESS;
  if (!usdc || !/^0x[0-9a-fA-F]{40}$/.test(usdc)) {
    throw new Error("Set a valid USDC_ADDRESS env var (the ERC-20 USDC on your target network).");
  }

  await assertTestnet(hre);
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying AgentMarketplace…");
  console.log("  network :", hre.network.name);
  console.log("  deployer:", deployer.address);
  console.log("  usdc    :", usdc);

  const Factory = await hre.ethers.getContractFactory("AgentMarketplace");
  const market = await Factory.deploy(usdc);
  await market.waitForDeployment();
  const addr = await market.getAddress();

  console.log("\n✅ AgentMarketplace deployed to:", addr);
  console.log("→ add to apps/web/.env.local:");
  console.log(`   NEXT_PUBLIC_MARKETPLACE_ADDRESS=${addr}`);
  console.log(`   NEXT_PUBLIC_USDC_ADDRESS=${usdc}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
