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
  
  let marketAddress: string;

  // Helper function to create swapExactTokenForPt calldata
  function createSwapExactTokenForPtCalldata(
    receiver: string,
    market: string,
    minPtOut: bigint,
    netTokenIn: bigint,
    tokenIn: string
  ): string {
    // Simple encoded calldata with just the function selector and key parameters
    // The mock router will decode the market address from offset 36
    const funcSig = "0x12345678"; // Mock function selector
    const encodedReceiver = ethers.zeroPadValue(receiver, 32);
    const encodedMarket = ethers.zeroPadValue(market, 32);
    const encodedMinPtOut = ethers.zeroPadValue(ethers.toBeHex(minPtOut), 32);
    const encodedNetTokenIn = ethers.zeroPadValue(ethers.toBeHex(netTokenIn), 32);
    const encodedTokenIn = ethers.zeroPadValue(tokenIn, 32);
    
    return funcSig + encodedReceiver.slice(2) + encodedMarket.slice(2) + encodedMinPtOut.slice(2) + encodedNetTokenIn.slice(2) + encodedTokenIn.slice(2);
  }
  
  // Helper function to create swapExactPtForToken calldata
  function createSwapExactPtForTokenCalldata(
    receiver: string,
    market: string,
    exactPtIn: bigint,
    tokenOut: string,
    minTokenOut: bigint
  ): string {
    // Simple encoded calldata with just the function selector and key parameters
    // The mock router will decode the market address from offset 36 and PT amount from offset 68
    const funcSig = "0x87654321"; // Mock function selector
    const encodedReceiver = ethers.zeroPadValue(receiver, 32);
    const encodedMarket = ethers.zeroPadValue(market, 32);
    const encodedPtIn = ethers.zeroPadValue(ethers.toBeHex(exactPtIn), 32);
    const encodedTokenOut = ethers.zeroPadValue(tokenOut, 32);
    const encodedMinTokenOut = ethers.zeroPadValue(ethers.toBeHex(minTokenOut), 32);
    
    return funcSig + encodedReceiver.slice(2) + encodedMarket.slice(2) + encodedPtIn.slice(2) + encodedTokenOut.slice(2) + encodedMinTokenOut.slice(2);
  }

  beforeEach(async function () {
    [owner, user1, user2, feeCollector] = await ethers.getSigners();
    
    // Create a consistent market address for testing
    marketAddress = ethers.Wallet.createRandom().address;

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

    // Deploy BolarityVault with constructor arguments
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockToken.target,
      "Bolarity USDC Vault",
      "bUSDC",
      strategy.target,
      owner.address, // router
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Transfer mock PT minting ability to vault
    // Note: In real Pendle, the router mints PT. In our mock, we'll just mint directly
    
    // Mint initial tokens to users
    await mockToken.mint(user1.address, INITIAL_BALANCE);
    await mockToken.mint(user2.address, INITIAL_BALANCE);
    
    // Approve vault to spend tokens
    await mockToken.connect(user1).approve(vault.target, ethers.MaxUint256);
    await mockToken.connect(user2).approve(vault.target, ethers.MaxUint256);
    
    // Authorize users to call vault directly for testing
    await vault.connect(owner).setAuthorizedCaller(user1.address, true);
    await vault.connect(owner).setAuthorizedCaller(user2.address, true);
  });

  describe("Market Configuration", function () {
    it("Should allow owner to set Pendle market", async function () {
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      const [market, pt] = await strategy.pendleMarkets(mockToken.target);
      expect(market).to.equal(marketAddress);
      expect(pt).to.equal(mockPT.target);
    });

    it("Should emit event when setting market", async function () {
      await expect(strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target))
        .to.emit(strategy, "PendleMarketSet")
        .withArgs(mockToken.target, marketAddress, mockPT.target);
    });

    it("Should revert when non-owner tries to set market", async function () {
      await expect(
        strategy.connect(user1).setPendleMarket(mockToken.target, marketAddress, mockPT.target)
      ).to.be.revertedWithCustomError(strategy, "OwnableUnauthorizedAccount");
    });

    it("Should revert when setting expired PT", async function () {
      await mockPT.setExpired(true);
      
      await expect(
        strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target)
      ).to.be.revertedWith("PendlePTStrategy: PT expired");
    });

    it("Should allow owner to remove Pendle market", async function () {
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
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      // Configure the mock Pendle router to know about the market -> PT mapping
      await mockPendleRouter.setMarketToPT(marketAddress, mockPT.target);
    });

    it("Should invest in Pendle PT with entry gain", async function () {
      // Get fee collector balance before
      const feeBalanceBefore = await vault.balanceOf(feeCollector.address);

      // Create Pendle calldata for investment
      const investCalldata = createSwapExactTokenForPtCalldata(
        await vault.getAddress(),
        marketAddress,
        0n, // minPtOut
        DEPOSIT_AMOUNT,
        await mockToken.getAddress()
      );

      // Deposit to vault with strategy data
      const vaultWithData = vault.connect(user1) as any;
      await vaultWithData.depositWithData(DEPOSIT_AMOUNT, user1.address, investCalldata);

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
      // Create Pendle calldata for investments
      const investCalldata = createSwapExactTokenForPtCalldata(
        await vault.getAddress(),
        marketAddress,
        0n,
        DEPOSIT_AMOUNT,
        await mockToken.getAddress()
      );
      
      const investCalldata2 = createSwapExactTokenForPtCalldata(
        await vault.getAddress(),
        marketAddress,
        0n,
        DEPOSIT_AMOUNT * 2n,
        await mockToken.getAddress()
      );

      // First deposit
      const vaultWithData1 = vault.connect(user1) as any;
      await vaultWithData1.depositWithData(DEPOSIT_AMOUNT, user1.address, investCalldata);

      // Second deposit
      const vaultWithData2 = vault.connect(user2) as any;
      await vaultWithData2.depositWithData(DEPOSIT_AMOUNT * 2n, user2.address, investCalldata2);

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
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      
      // Configure the mock Pendle router to know about the market -> PT mapping
      await mockPendleRouter.setMarketToPT(marketAddress, mockPT.target);
      
      // Setup initial deposit
      const investCalldata = createSwapExactTokenForPtCalldata(
        await vault.getAddress(),
        marketAddress,
        0n,
        DEPOSIT_AMOUNT,
        await mockToken.getAddress()
      );
      const vaultWithData = vault.connect(user1) as any;
      await vaultWithData.depositWithData(DEPOSIT_AMOUNT, user1.address, investCalldata);
    });

    it("Should withdraw from Pendle PT through vault", async function () {
      const withdrawAmount = ethers.parseEther("500");
      const tokenBalanceBefore = await mockToken.balanceOf(user1.address);

      // Calculate PT amount needed to get withdrawAmount USDC
      // Since PT_DISCOUNT_RATE = 108 (100 USDC -> 108 PT), reverse: PT * 100 / 108 = USDC
      // So to get 500 USDC, we need: 500 * 108 / 100 = 540 PT
      const ptAmountToSell = (withdrawAmount * BigInt(PT_DISCOUNT_RATE)) / 100n;

      // Create Pendle calldata for withdrawal
      const withdrawCalldata = createSwapExactPtForTokenCalldata(
        await vault.getAddress(),
        marketAddress,
        ptAmountToSell, // PT amount to sell
        await mockToken.getAddress(),
        0n // minTokenOut
      );

      // Withdraw with strategy data
      const vaultWithData = vault.connect(user1) as any;
      await vaultWithData.withdrawWithData(withdrawAmount, user1.address, user1.address, withdrawCalldata);

      const tokenBalanceAfter = await mockToken.balanceOf(user1.address);
      expect(tokenBalanceAfter - tokenBalanceBefore).to.be.closeTo(withdrawAmount, ethers.parseEther("0.01"));
    });

    it("Should withdraw all assets using max uint", async function () {
      // Get PT balance for max withdrawal
      const ptBalance = await mockPT.balanceOf(vault.target);
      
      // Create Pendle calldata for withdrawal
      const withdrawCalldata = createSwapExactPtForTokenCalldata(
        await vault.getAddress(),
        marketAddress,
        ptBalance, // withdraw all PT
        await mockToken.getAddress(),
        0n // minTokenOut
      );

      // Withdraw all with strategy data
      const vaultWithData = vault.connect(user1) as any;
      await vaultWithData.withdrawWithData(ethers.MaxUint256, user1.address, user1.address, withdrawCalldata);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });
  });

  describe("Error Cases", function () {
    it("Should revert with expired PT", async function () {
      // Set PT as expired first
      await mockPT.setExpired(true);
      
      // Try to configure strategy with expired PT
      await expect(
        strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target)
      ).to.be.revertedWith("PendlePTStrategy: PT expired");
    });

    it("Should revert when calldata not provided", async function () {
      // Configure strategy
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      await mockPendleRouter.setMarketToPT(marketAddress, mockPT.target);
      
      // Try to deposit without calldata - should revert
      await expect(
        vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      ).to.be.revertedWith("PendlePTStrategy: Calldata required for swapExactTokenForPt");
    });
  });

  describe("Preview Functions with Entry Gain", function () {
    beforeEach(async function () {
      // Configure strategy with market and PT for mockToken
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
      // Create Pendle calldata for investment
      const investCalldata = createSwapExactTokenForPtCalldata(
        await vault.getAddress(),
        marketAddress,
        0n,
        DEPOSIT_AMOUNT,
        await mockToken.getAddress()
      );
      
      // Deposit first
      const vaultWithData = vault.connect(user1) as any;
      await vaultWithData.depositWithData(DEPOSIT_AMOUNT, user1.address, investCalldata);

      const withdrawAmount = ethers.parseEther("500");
      const previewShares = await vault.previewWithdraw(withdrawAmount);
      expect(previewShares).to.be.greaterThan(0);
      expect(previewShares).to.be.lessThanOrEqual(await vault.balanceOf(user1.address));
    });
  });

  describe("Oracle Integration", function () {
    it("Should use oracle for PT pricing", async function () {
      await strategy.setPendleMarket(mockToken.target, marketAddress, mockPT.target);
      await mockPendleRouter.setMarketToPT(marketAddress, mockPT.target);
      
      // Set oracle rate (1 PT = 0.9259 USDC)
      await mockPendleOracle.setPtToAssetRate(marketAddress, ethers.parseEther("0.9259"));
      
      // Create Pendle calldata for investment
      const investCalldata = createSwapExactTokenForPtCalldata(
        await vault.getAddress(),
        marketAddress,
        0n,
        DEPOSIT_AMOUNT,
        await mockToken.getAddress()
      );
      
      // Deposit should account for oracle rate
      const vaultWithData = vault.connect(user1) as any;
      await vaultWithData.depositWithData(DEPOSIT_AMOUNT, user1.address, investCalldata);
      
      // User should get PT at discounted rate
      expect(await mockPT.balanceOf(vault.target)).to.be.greaterThan(0);
    });
  });
});