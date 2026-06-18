/* eslint-disable no-undef */
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

// 100 USDC (6 decimals) → clean splits: 80 / 12 / 5 / 3.
const AMOUNT = 100_000_000n;
const CREATOR = 80_000_000n;
const PLATFORM = 12_000_000n;
const REFERRER = 5_000_000n;
const RESERVE = 3_000_000n;

async function deploy() {
  const [deployer, payer, creator, referrer, platform, owner, drainTo] = await ethers.getSigners();
  const USDC = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const split = await (await ethers.getContractFactory("RevenueSplit")).deploy(
    await USDC.getAddress(),
    platform.address,
    owner.address
  );
  // Fund the payer and approve the splitter.
  await USDC.faucet(payer.address, AMOUNT * 10n);
  await USDC.connect(payer).approve(await split.getAddress(), AMOUNT * 10n);
  return { USDC, split, payer, creator, referrer, platform, owner, drainTo };
}

describe("RevenueSplit", () => {
  it("splits 80/12/5/3 with a referrer", async () => {
    const { USDC, split, payer, creator, referrer, platform } = await deploy();
    await expect(split.connect(payer).split(creator.address, referrer.address, AMOUNT))
      .to.emit(split, "PaymentSplit")
      .withArgs(payer.address, creator.address, referrer.address, AMOUNT, CREATOR, PLATFORM, REFERRER, RESERVE);

    expect(await USDC.balanceOf(creator.address)).to.equal(CREATOR);
    expect(await USDC.balanceOf(platform.address)).to.equal(PLATFORM);
    expect(await USDC.balanceOf(referrer.address)).to.equal(REFERRER);
    expect(await split.reserveBalance()).to.equal(RESERVE);
    expect(await USDC.balanceOf(await split.getAddress())).to.equal(RESERVE);
  });

  it("folds the referrer share into the reserve when referrer is address(0)", async () => {
    const { USDC, split, payer, creator, platform } = await deploy();
    await split.connect(payer).split(creator.address, ethers.ZeroAddress, AMOUNT);

    expect(await USDC.balanceOf(creator.address)).to.equal(CREATOR);
    expect(await USDC.balanceOf(platform.address)).to.equal(PLATFORM);
    expect(await split.reserveBalance()).to.equal(RESERVE + REFERRER); // 3% + 5% = 8%
  });

  it("absorbs a rejected creator payout into the reserve (reader not blocked)", async () => {
    const [, payer, creator, referrer, platform, owner] = await ethers.getSigners();
    const USDC = await (await ethers.getContractFactory("FlakyUSDC")).deploy();
    const split = await (await ethers.getContractFactory("RevenueSplit")).deploy(
      await USDC.getAddress(),
      platform.address,
      owner.address
    );
    await USDC.faucet(payer.address, AMOUNT);
    await USDC.connect(payer).approve(await split.getAddress(), AMOUNT);
    await USDC.setReject(creator.address, true); // creator wallet rejects transfers

    await expect(split.connect(payer).split(creator.address, referrer.address, AMOUNT))
      .to.emit(split, "PayoutAbsorbed")
      .withArgs(creator.address, CREATOR);

    expect(await USDC.balanceOf(creator.address)).to.equal(0n);
    expect(await USDC.balanceOf(referrer.address)).to.equal(REFERRER);
    expect(await split.reserveBalance()).to.equal(RESERVE + CREATOR); // creator share absorbed
  });

  it("lets only the owner drain the reserve", async () => {
    const { USDC, split, payer, creator, referrer, owner, drainTo } = await deploy();
    await split.connect(payer).split(creator.address, referrer.address, AMOUNT);

    await expect(split.connect(payer).withdrawReserve(drainTo.address)).to.be.reverted; // not owner
    await expect(split.connect(owner).withdrawReserve(drainTo.address))
      .to.emit(split, "ReserveWithdrawn")
      .withArgs(drainTo.address, RESERVE);

    expect(await USDC.balanceOf(drainTo.address)).to.equal(RESERVE);
    expect(await split.reserveBalance()).to.equal(0n);
  });

  it("lets only the owner update the platform address", async () => {
    const { split, payer, owner, drainTo } = await deploy();
    await expect(split.connect(payer).updatePlatformAddress(drainTo.address)).to.be.reverted;
    await split.connect(owner).updatePlatformAddress(drainTo.address);
    expect(await split.platform()).to.equal(drainTo.address);
  });

  it("rejects zero creator and zero amount", async () => {
    const { split, payer, creator, referrer } = await deploy();
    await expect(split.connect(payer).split(ethers.ZeroAddress, referrer.address, AMOUNT)).to.be.revertedWith("creator=0");
    await expect(split.connect(payer).split(creator.address, referrer.address, 0n)).to.be.revertedWith("amount=0");
  });
});
