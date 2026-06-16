/* eslint-disable no-console */
const hre = require("hardhat");
const { assertTestnet } = require("./_testnet-guard.cjs");

/**
 * Deploys RevenueSplit to Arc TESTNET with (test) USDC + platform + referrer
 * from env. After deploy, copy the printed address into REVENUE_SPLIT_ADDRESS
 * in .env so the x402 endpoint routes payments through the on-chain split.
 */
async function main() {
  await assertTestnet(hre);
  const usdc = process.env.USDC_ADDRESS;
  const platform = process.env.PLATFORM_ADDRESS;
  const referrer = process.env.REFERRER_ADDRESS;
  if (!usdc || !platform || !referrer) {
    throw new Error("Set USDC_ADDRESS, PLATFORM_ADDRESS, REFERRER_ADDRESS in .env");
  }

  const Factory = await hre.ethers.getContractFactory("RevenueSplit");
  const contract = await Factory.deploy(usdc, platform, referrer);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();

  console.log("RevenueSplit deployed to:", addr);
  console.log("→ add to .env:  REVENUE_SPLIT_ADDRESS=" + addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
