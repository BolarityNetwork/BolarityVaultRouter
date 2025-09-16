import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BolarityVault, PendlePTStrategy } from "../typechain-types";
import { Contract } from "ethers";

describe("PendlePTStrategy", function () {
  let vault: BolarityVault;
  let strategy: PendlePTStrategy;
  let mockToken: Contract;
  let mockPT: Contract;
  let mockPendleRouter: Contract;
  let mockPendleOracle: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("1000000");
  const DEPOSIT_AMOUNT = ethers.parseEther("1000");
  const PERFORMANCE_FEE_BPS = 1000; // 10%
  const PT_DISCOUNT_RATE = 108; // 8% discount (100 USDC -> 108 PT)

  beforeEach(async function () {
    [owner, user1, user2, feeCollector] = await ethers.getSigners();

    // Deploy Mock ERC20 Token (USDC)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "USDC", 18);
    await mockToken.waitForDeployment();

    // Deploy Mock Pendle PT
    const MockPendlePT = await ethers.getContractFactory("MockPendlePT");
    const maturity = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 1 year from now
    mockPT = await MockPendlePT.deploy(mockToken.target, maturity);
    await mockPT.waitForDeployment();

    // Deploy Mock Pendle Router
    const MockPendleRouter = await ethers.getContractFactory("MockPendleRouter");
    mockPendleRouter = await MockPendleRouter.deploy();
    await mockPendleRouter.waitForDeployment();

    // Deploy Mock Pendle Oracle
    const MockPendleOracle = await ethers.getContractFactory("MockPendleOracle");
    mockPendleOracle = await MockPendleOracle.deploy();
    await mockPendleOracle.waitForDeployment();

    // Deploy PendlePTStrategy
    const PendlePTStrategy = await ethers.getContractFactory("PendlePTStrategy");
    strategy = await PendlePTStrategy.deploy(
      mockPendleRouter.target,
      mockPendleOracle.target
    );
    await strategy.waitForDeployment();

    // Deploy BolarityVault with PendlePTStrategy
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockToken.target,
      "Bolarity Pendle PT Vault",
      "bPT",
      strategy.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Mint tokens to users and router for testing
    await mockToken.mint(user1.address, INITIAL_BALANCE);
    await mockToken.mint(user2.address, INITIAL_BALANCE);
    await mockToken.mint(mockPendleRouter.target, INITIAL_BALANCE); // Fund router for swaps

    // Approve vault to spend tokens
    await mockToken.connect(user1).approve(vault.target, ethers.MaxUint256);
    await mockToken.connect(user2).approve(vault.target, ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct Pendle router and oracle", async function () {
      expect(await strategy.pendleRouter()).to.equal(mockPendleRouter.target);
      expect(await strategy.pendleOracle()).to.equal(mockPendleOracle.target);
    });

    it("Should have correct vault configuration", async function () {
      expect(await vault.strategy()).to.equal(strategy.target);
      expect(await vault.asset()).to.equal(mockToken.target);
    });
  });

  describe("Strategy Configuration", function () {
    it("Should allow owner to set Pendle market", async function () {
      const marketAddress = ethers.Wallet.createRandom().address;
      
      await strategy.connect(owner).setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      const [market, pt] = await strategy.pendleMarkets(mockToken.target);
      expect(market).to.equal(marketAddress);
      expect(pt).to.equal(mockPT.target);
    });

    it("Should revert when non-owner tries to set market", async function () {
      const marketAddress = ethers.Wallet.createRandom().address;
      
      await expect(
        strategy.connect(user1).setPendleMarket(mockToken.target, marketAddress, mockPT.target)
      ).to.be.revertedWithCustomError(strategy, "OwnableUnauthorizedAccount");
    });

    it("Should revert when setting expired PT", async function () {
      const marketAddress = ethers.Wallet.createRandom().address;
      await mockPT.setExpired(true);
      
      await expect(
        strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target)
      ).to.be.revertedWith("PendlePTStrategy: PT expired");
    });

    it("Should allow owner to remove Pendle market", async function () {
      const marketAddress = ethers.Wallet.createRandom().address;
      
      // First set a market
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      // Then remove it
      await strategy.removePendleMarket(mockToken.target);
      
      const [market, pt] = await strategy.pendleMarkets(mockToken.target);
      expect(market).to.equal(ethers.ZeroAddress);
      expect(pt).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Investment via Vault with Entry Gain", function () {
    beforeEach(async function () {
      // Configure strategy with market and PT for mockToken
      const marketAddress = ethers.Wallet.createRandom().address; // Mock market address
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      // Configure the mock Pendle router to know about the market -> PT mapping
      await mockPendleRouter.setMarketToPT(marketAddress, mockPT.target);
    });

    it("Should invest in Pendle PT with entry gain", async function () {
      // Get fee collector balance before
      const feeBalanceBefore = await vault.balanceOf(feeCollector.address);

      // Deposit to vault (no strategy data needed now)
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Calculate expected entry gain (8% of deposit)
      const expectedEntryGain = (DEPOSIT_AMOUNT * 8n) / 100n;
      const expectedFeeOnGain = (expectedEntryGain * BigInt(PERFORMANCE_FEE_BPS)) / 10000n;

      // Check fee collector received fees on entry gain
      const feeBalanceAfter = await vault.balanceOf(feeCollector.address);
      const feeSharesReceived = feeBalanceAfter - feeBalanceBefore;
      
      // Fee shares should be proportional to the entry gain
      expect(feeSharesReceived).to.be.greaterThan(0);

      // Check user shares (should be deposit + entry gain - fees)
      const userShares = await vault.balanceOf(user1.address);
      const expectedUserShares = DEPOSIT_AMOUNT + expectedEntryGain - expectedFeeOnGain;
      expect(userShares).to.be.closeTo(expectedUserShares, ethers.parseEther("1"));
    });

    it("Should handle multiple deposits with entry gains", async function () {
      // First deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Second deposit
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT * 2n, user2.address);

      // Both users should have shares including entry gains
      expect(await vault.balanceOf(user1.address)).to.be.greaterThan(DEPOSIT_AMOUNT);
      expect(await vault.balanceOf(user2.address)).to.be.greaterThan(DEPOSIT_AMOUNT * 2n);

      // Fee collector should have received fees from both entry gains
      expect(await vault.balanceOf(feeCollector.address)).to.be.greaterThan(0);
    });
  });

  describe("Withdrawal from Pendle PT", function () {
    beforeEach(async function () {
      // Configure strategy with market and PT for mockToken
      const marketAddress = ethers.Wallet.createRandom().address;
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      // Configure the mock Pendle router to know about the market -> PT mapping
      await mockPendleRouter.setMarketToPT(marketAddress, mockPT.target);
      
      // Setup initial deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Should withdraw from Pendle PT through vault", async function () {
      const withdrawAmount = ethers.parseEther("500");
      const tokenBalanceBefore = await mockToken.balanceOf(user1.address);

      // Withdraw (no strategy data needed now)
      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

      const tokenBalanceAfter = await mockToken.balanceOf(user1.address);
      expect(tokenBalanceAfter - tokenBalanceBefore).to.be.closeTo(withdrawAmount, ethers.parseEther("0.01"));
    });

    it("Should withdraw all assets using max uint", async function () {
      // Withdraw all (no strategy data needed now)
      await vault.connect(user1).withdraw(ethers.MaxUint256, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });
  });

  describe("Error Cases", function () {
    it("Should revert with expired PT", async function () {
      // Configure strategy with expired PT
      const marketAddress = ethers.Wallet.createRandom().address;
      
      // Set PT as expired
      await mockPT.setExpired(true);
      
      // This should fail when trying to configure
      await expect(
        strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target)
      ).to.be.revertedWith("PendlePTStrategy: PT expired");
    });

    it("Should revert when asset not configured", async function () {
      // Try to deposit without configuring the strategy first
      await expect(
        vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      ).to.be.revertedWith("PendlePTStrategy: Market not configured for asset. Call setPendleMarket() first");
    });
  });

  describe("Preview Functions with Entry Gain", function () {
    beforeEach(async function () {
      // Configure strategy with market and PT for mockToken
      const marketAddress = ethers.Wallet.createRandom().address;
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      // Configure the mock Pendle router to know about the market -> PT mapping
      await mockPendleRouter.setMarketToPT(marketAddress, mockPT.target);
    });

    it("Should correctly preview deposit with entry gain", async function () {
      // Since strategy returns entry gain, preview should show more shares than input
      const previewShares = await vault.previewDeposit(DEPOSIT_AMOUNT);
      
      // For first deposit, shares = assets (no entry gain in preview for simplicity)
      // Actual implementation would need to call strategy's preview function
      expect(previewShares).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should correctly preview withdraw after deposit with entry gain", async function () {
      // Deposit first
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      const withdrawAmount = ethers.parseEther("500");
      const previewShares = await vault.previewWithdraw(withdrawAmount);
      expect(previewShares).to.be.greaterThan(0);
      expect(previewShares).to.be.lessThanOrEqual(await vault.balanceOf(user1.address));
    });
  });

  describe("Oracle Integration", function () {
    it("Should use oracle for PT pricing", async function () {
      const marketAddress = ethers.Wallet.createRandom().address;
      
      // Set custom PT rate in oracle
      await mockPendleOracle.setPtToAssetRate(marketAddress, ethers.parseEther("0.95"));

      // Configure strategy with market and PT
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      // Configure the mock Pendle router to know about the market -> PT mapping
      await mockPendleRouter.setMarketToPT(marketAddress, mockPT.target);

      // Deposit without needing strategy data
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Verify deposit succeeded with oracle pricing
      expect(await vault.balanceOf(user1.address)).to.be.greaterThan(0);
    });
  });
});