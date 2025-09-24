import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BolarityVault, MockERC20, TestAaveStrategy, MockAavePool, MockAToken } from "../typechain-types";

describe("BolarityVault Performance Fee - Solution 3", function () {
  let vault: BolarityVault;
  let mockToken: MockERC20;
  let mockAavePool: MockAavePool;
  let mockAToken: MockAToken;
  let strategy: TestAaveStrategy;
  
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("10000");
  const DEPOSIT_AMOUNT = ethers.parseEther("1000");
  const PERFORMANCE_FEE_BPS = 1000; // 10%
  
  beforeEach(async function () {
    [owner, user1, user2, feeCollector] = await ethers.getSigners();

    // Deploy mock token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock Token", "MOCK", 18);
    await mockToken.waitForDeployment();

    // Deploy mock Aave pool
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAavePool = await MockAavePool.deploy();
    await mockAavePool.waitForDeployment();

    // Deploy mock aToken
    const MockAToken = await ethers.getContractFactory("contracts/mocks/MockAaveDataProvider.sol:MockAToken");
    mockAToken = await MockAToken.deploy(mockToken.target);
    await mockAToken.waitForDeployment();
    
    // Initialize reserve in pool
    await mockAavePool.initReserve(mockToken.target, mockAToken.target);
    
    // Get the pool data provider address
    const poolDataProviderAddress = await mockAavePool.poolDataProvider();

    // Deploy TestAaveStrategy (with totalUnderlying support)
    const TestAaveStrategy = await ethers.getContractFactory("TestAaveStrategy");
    strategy = await TestAaveStrategy.deploy(mockAavePool.target, poolDataProviderAddress);
    await strategy.waitForDeployment();

    // Deploy BolarityVault
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockToken.target,
      "Test Vault",
      "tVAULT",
      strategy.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Mint tokens to users
    await mockToken.mint(user1.address, INITIAL_BALANCE);
    await mockToken.mint(user2.address, INITIAL_BALANCE);
    
    // Mint tokens to owner for simulating gains/losses
    await mockToken.mint(owner.address, ethers.parseEther("100000"));

    // Approve vault
    await mockToken.connect(user1).approve(vault.target, ethers.MaxUint256);
    await mockToken.connect(user2).approve(vault.target, ethers.MaxUint256);
    
    // Approve aToken for owner to simulate gains
    await mockToken.connect(owner).approve(mockAToken.target, ethers.MaxUint256);
  });

  describe("Performance Fee with High Water Mark (Solution 3)", function () {
    it("Should NOT update lastP when there's a loss", async function () {
      // Initial deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Record initial lastP
      const initialLastP = await vault.lastP();
      expect(initialLastP).to.be.gt(0);
      
      // Simulate a loss by removing tokens from aToken
      const aTokenBalance = await mockToken.balanceOf(mockAToken.target);
      const lossAmount = aTokenBalance / 2n; // 50% loss
      await mockAToken.connect(owner).simulateLoss(lossAmount);
      
      // Trigger fee crystallization through another deposit
      await vault.connect(user2).deposit(ethers.parseEther("100"), user2.address);
      
      // Check that lastP hasn't been updated (maintains high water mark)
      const currentLastP = await vault.lastP();
      expect(currentLastP).to.equal(initialLastP);
      
      // No fees should be collected during loss
      const feeCollectorBalance = await vault.balanceOf(feeCollector.address);
      expect(feeCollectorBalance).to.equal(0);
    });

    it("Should charge fees only on gains above high water mark", async function () {
      // Initial deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const initialLastP = await vault.lastP();
      
      // Simulate a 20% gain
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("200"));
      
      // Crystallize fees
      await vault.crystallizeFees();
      const lastPAfterGain = await vault.lastP();
      expect(lastPAfterGain).to.be.gt(initialLastP);
      
      // Check fee collector received fees
      const feeBalanceAfterGain = await vault.balanceOf(feeCollector.address);
      expect(feeBalanceAfterGain).to.be.gt(0);
      
      // Simulate a 30% loss
      const currentATokenBalance = await mockToken.balanceOf(mockAToken.target);
      await mockAToken.connect(owner).simulateLoss(currentATokenBalance * 30n / 100n);
      
      // Crystallize fees (should not update lastP)
      await vault.crystallizeFees();
      const lastPAfterLoss = await vault.lastP();
      expect(lastPAfterLoss).to.equal(lastPAfterGain); // High water mark maintained
      
      // Simulate recovery to just below previous high
      const targetBalance = (DEPOSIT_AMOUNT * 115n) / 100n; // 15% above initial, but below previous high
      const currentBalance = await mockToken.balanceOf(mockAToken.target);
      if (targetBalance > currentBalance) {
        await mockAToken.connect(owner).simulateGain(targetBalance - currentBalance);
      }
      
      // Crystallize fees (should not charge fees as we're below high water mark)
      const feeBalanceBefore = await vault.balanceOf(feeCollector.address);
      await vault.crystallizeFees();
      const feeBalanceAfter = await vault.balanceOf(feeCollector.address);
      expect(feeBalanceAfter).to.equal(feeBalanceBefore); // No new fees
      
      // Simulate gain above previous high water mark
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("500"));
      
      // Now fees should be charged only on gains above high water mark
      await vault.crystallizeFees();
      const finalFeeBalance = await vault.balanceOf(feeCollector.address);
      expect(finalFeeBalance).to.be.gt(feeBalanceAfter);
      
      // lastP should be updated to new high
      const finalLastP = await vault.lastP();
      expect(finalLastP).to.be.gt(lastPAfterGain);
    });

    it("Should handle multiple loss/gain cycles correctly", async function () {
      // Initial deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const initialShares = await vault.balanceOf(user1.address);
      
      // Track high water marks
      const highWaterMarks: bigint[] = [await vault.lastP()];
      
      // Cycle 1: Gain 20%
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("200"));
      await vault.crystallizeFees();
      highWaterMarks.push(await vault.lastP());
      expect(highWaterMarks[1]).to.be.gt(highWaterMarks[0]);
      
      // Cycle 2: Loss 10%
      const balance1 = await mockToken.balanceOf(mockAToken.target);
      await mockAToken.connect(owner).simulateLoss(balance1 * 10n / 100n);
      await vault.crystallizeFees();
      const lastPAfterLoss = await vault.lastP();
      expect(lastPAfterLoss).to.equal(highWaterMarks[1]); // Should maintain high water mark
      
      // Cycle 3: Gain 5% (still below high water mark)
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("50"));
      const feeBalanceBefore = await vault.balanceOf(feeCollector.address);
      await vault.crystallizeFees();
      const feeBalanceAfter = await vault.balanceOf(feeCollector.address);
      expect(feeBalanceAfter).to.equal(feeBalanceBefore); // No new fees
      expect(await vault.lastP()).to.equal(highWaterMarks[1]); // High water mark unchanged
      
      // Cycle 4: Gain 20% (above high water mark)
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("300"));
      await vault.crystallizeFees();
      const newHighWaterMark = await vault.lastP();
      expect(newHighWaterMark).to.be.gt(highWaterMarks[1]);
      expect(await vault.balanceOf(feeCollector.address)).to.be.gt(feeBalanceAfter);
    });

    it("Should correctly calculate preview functions during loss periods", async function () {
      // Initial deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Simulate a loss
      const aTokenBalance = await mockToken.balanceOf(mockAToken.target);
      await mockAToken.connect(owner).simulateLoss(aTokenBalance * 20n / 100n); // 20% loss
      
      // Preview functions should work correctly without updating lastP
      const previewDeposit = await vault.previewDeposit(ethers.parseEther("100"));
      const previewMint = await vault.previewMint(ethers.parseEther("100"));
      const previewWithdraw = await vault.previewWithdraw(ethers.parseEther("80"));
      const previewRedeem = await vault.previewRedeem(ethers.parseEther("100"));
      
      // All preview functions should return reasonable values
      expect(previewDeposit).to.be.gt(0);
      expect(previewMint).to.be.gt(0);
      expect(previewWithdraw).to.be.gt(0);
      expect(previewRedeem).to.be.gt(0);
      
      // Actual operations should work correctly
      await vault.connect(user2).deposit(ethers.parseEther("100"), user2.address);
      const user2Shares = await vault.balanceOf(user2.address);
      expect(user2Shares).to.be.closeTo(previewDeposit, ethers.parseEther("0.01"));
    });

    it("Should handle zero supply edge case", async function () {
      // Test that _accruePerfFee handles zero supply correctly
      const feeShares = await vault.crystallizeFees();
      
      // Should not revert and should not mint any fees
      expect(await vault.balanceOf(feeCollector.address)).to.equal(0);
    });

    it("Should handle zero performance fee setting", async function () {
      // Set performance fee to 0
      await vault.setPerfFeeBps(0);
      
      // Deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Simulate gain
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("200"));
      
      // Crystallize fees (should not mint any fees)
      await vault.crystallizeFees();
      expect(await vault.balanceOf(feeCollector.address)).to.equal(0);
    });

    it("Should maintain correct lastP through deposit/withdraw cycles", async function () {
      // Initial deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const initialLastP = await vault.lastP();
      
      // Gain and crystallize
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("100"));
      await vault.crystallizeFees();
      const highWaterMark = await vault.lastP();
      expect(highWaterMark).to.be.gt(initialLastP);
      
      // Loss
      const balance = await mockToken.balanceOf(mockAToken.target);
      await mockAToken.connect(owner).simulateLoss(balance * 15n / 100n);
      
      // Withdraw (should not affect high water mark)
      const user1Shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(user1Shares / 2n, user1.address, user1.address);
      expect(await vault.lastP()).to.equal(highWaterMark);
      
      // New deposit (should not affect high water mark)
      await vault.connect(user2).deposit(ethers.parseEther("500"), user2.address);
      expect(await vault.lastP()).to.equal(highWaterMark);
      
      // Gain above high water mark
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("300"));
      await vault.crystallizeFees();
      expect(await vault.lastP()).to.be.gt(highWaterMark);
    });

    it("Should NOT accrue fees when feeCollector withdraws or redeems", async function () {
      // Initial deposit by user1
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Check initial state
      const totalAssetsBeforeGain = await vault.totalAssets();
      console.log("Total assets before gain:", totalAssetsBeforeGain.toString());
      
      // Simulate gain in strategy
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("100"));
      
      // Check assets after gain
      const totalAssetsAfterGain = await vault.totalAssets();
      console.log("Total assets after gain:", totalAssetsAfterGain.toString());
      console.log("Gain amount:", (totalAssetsAfterGain - totalAssetsBeforeGain).toString());
      
      // Get values before crystallization
      const totalSupplyBefore = await vault.totalSupply();
      console.log("Total supply before crystallize:", totalSupplyBefore.toString());
      const lastPBefore = await vault.lastP();
      console.log("lastP before crystallize:", lastPBefore.toString());
      
      // Crystallize fees - feeCollector should get fee shares
      await vault.crystallizeFees();
      
      // Check values after crystallization
      const totalSupplyAfter = await vault.totalSupply();
      console.log("Total supply after crystallize:", totalSupplyAfter.toString());
      const lastPAfter = await vault.lastP();
      console.log("lastP after crystallize:", lastPAfter.toString());
      
      const feeCollectorInitialShares = await vault.balanceOf(feeCollector.address);
      console.log("FeeCollector shares:", feeCollectorInitialShares.toString());
      expect(feeCollectorInitialShares).to.be.gt(0);
      
      // Record total supply before feeCollector withdrawal
      const totalSupplyBefore2 = await vault.totalSupply();
      
      // Simulate another gain
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("50"));
      
      // FeeCollector withdraws all their shares
      // This should NOT trigger additional fee accrual for the feeCollector
      await vault.connect(feeCollector).redeem(
        feeCollectorInitialShares,
        feeCollector.address,
        feeCollector.address
      );
      
      // Check that no new shares were minted to feeCollector during withdrawal
      const feeCollectorFinalShares = await vault.balanceOf(feeCollector.address);
      expect(feeCollectorFinalShares).to.equal(0);
      
      // Total supply should decrease by exactly the amount redeemed
      const totalSupplyAfter2 = await vault.totalSupply();
      expect(totalSupplyBefore2 - totalSupplyAfter2).to.equal(feeCollectorInitialShares);
    });

    it("FeeCollector should be able to withdraw all their earned fees cleanly", async function () {
      // User1 deposits
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Generate profits multiple times
      for (let i = 0; i < 3; i++) {
        await mockAToken.connect(owner).simulateGain(ethers.parseEther("100"));
        await vault.crystallizeFees();
      }
      
      // Get feeCollector's total shares
      const feeCollectorShares = await vault.balanceOf(feeCollector.address);
      expect(feeCollectorShares).to.be.gt(0);
      
      // Calculate expected assets for feeCollector
      const expectedAssets = await vault.convertToAssets(feeCollectorShares);
      
      // FeeCollector withdraws all shares
      const tx = await vault.connect(feeCollector).redeem(
        feeCollectorShares,
        feeCollector.address,
        feeCollector.address
      );
      
      // Check that feeCollector received the correct amount
      const feeCollectorBalance = await mockToken.balanceOf(feeCollector.address);
      expect(feeCollectorBalance).to.be.closeTo(expectedAssets, ethers.parseEther("0.01"));
      
      // FeeCollector should have no shares left
      expect(await vault.balanceOf(feeCollector.address)).to.equal(0);
    });
  });

  describe("Backward Compatibility", function () {
    it("Should work correctly with AAVE strategy", async function () {
      // Deposit through vault (uses AAVE strategy)
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Check that funds are in AAVE
      const aTokenBalance = await mockAToken.balanceOf(vault.target);
      expect(aTokenBalance).to.equal(DEPOSIT_AMOUNT);
      
      // Simulate AAVE gains
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("100"));
      
      // Crystallize fees
      await vault.crystallizeFees();
      
      // Check fees were collected
      expect(await vault.balanceOf(feeCollector.address)).to.be.gt(0);
      
      // Withdraw should work correctly
      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(shares, user1.address, user1.address);
    });

    it("Should handle strategy switching with high water mark", async function () {
      // Initial deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Gain and set high water mark
      await mockAToken.connect(owner).simulateGain(ethers.parseEther("200"));
      await vault.crystallizeFees();
      const highWaterMark = await vault.lastP();
      
      // Deploy new strategy
      const TestAaveStrategy2 = await ethers.getContractFactory("TestAaveStrategy");
      const newStrategy = await TestAaveStrategy2.deploy(mockAavePool.target, await mockAavePool.poolDataProvider());
      await newStrategy.waitForDeployment();
      
      // Whitelist the new strategy first
      await vault.whitelistStrategy(newStrategy.target, true);
      
      // Queue strategy change
      await vault.queueStrategyChange(newStrategy.target);
      
      // Fast-forward time to pass the timelock (48 hours)
      await ethers.provider.send("evm_increaseTime", [172800]); // 48 * 3600
      await ethers.provider.send("evm_mine", []);
      
      // Execute strategy change
      await vault.executeStrategyChange();
      
      // High water mark should be maintained
      expect(await vault.lastP()).to.equal(highWaterMark);
      
      // New deposits should work with new strategy
      await vault.connect(user2).deposit(ethers.parseEther("500"), user2.address);
      
      // High water mark should still be maintained
      expect(await vault.lastP()).to.equal(highWaterMark);
    });
  });
});