/* eslint-disable no-console */
const hre = require("hardhat");
const { assertTestnet } = require("./_testnet-guard.cjs");

/**
 * Deploys MockUSDC (6-decimal test token with an open faucet) and mints
 * 1,000,000 to the deployer. Use only when your target testnet has no canonical
 * USDC. Prints the address to feed into the marketplace deploy + frontend env.
 *
 *   npm run deploy:mock-usdc
 */
async function main() {
  await assertTestnet(hre);
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying MockUSDC (TEST token) on", hre.network.name, "from", deployer.address);

  const Factory = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await Factory.deploy();
  await usdc.waitForDeployment();
  const addr = await usdc.getAddress();

  console.log("\n✅ MockUSDC deployed to:", addr);
  console.log("→ use it:");
  console.log(`   USDC_ADDRESS=${addr} npm run deploy:marketplace`);
  console.log(`   and set NEXT_PUBLIC_USDC_ADDRESS=${addr} in apps/web/.env.local`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
