import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BolarityVault, CompoundStrategy } from "../typechain-types";
import { Contract } from "ethers";

describe("CompoundStrategy", function () {
  let vault: BolarityVault;
  let strategy: CompoundStrategy;
  let mockToken: Contract;
  let mockComet: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("1000000");
  const DEPOSIT_AMOUNT = ethers.parseEther("1000");
  const PERFORMANCE_FEE_BPS = 1000; // 10%

  beforeEach(async function () {
    [owner, user1, user2, feeCollector] = await ethers.getSigners();

    // Deploy Mock ERC20 Token (Base Token for Compound V3)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "USDC", 18);
    await mockToken.waitForDeployment();

    // Deploy Mock Comet (Compound V3)
    const MockComet = await ethers.getContractFactory("MockComet");
    mockComet = await MockComet.deploy(mockToken.target);
    await mockComet.waitForDeployment();

    // Deploy CompoundStrategy (msg.sender becomes owner)
    const CompoundStrategy = await ethers.getContractFactory("CompoundStrategy");
    strategy = await CompoundStrategy.connect(owner).deploy();
    await strategy.waitForDeployment();

    // Set up the Comet market for mockToken
    await strategy.setCometMarket(mockToken.target, mockComet.target);

    // Deploy BolarityVault with CompoundStrategy
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockToken.target,
      "Bolarity Compound V3 Vault",
      "bCOMPv3",
      strategy.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Mint tokens to users and Comet for testing
    await mockToken.mint(user1.address, INITIAL_BALANCE);
    await mockToken.mint(user2.address, INITIAL_BALANCE);
    await mockToken.mint(mockComet.target, INITIAL_BALANCE); // Fund Comet for withdrawals

    // Approve vault to spend tokens
    await mockToken.connect(user1).approve(vault.target, ethers.MaxUint256);
    await mockToken.connect(user2).approve(vault.target, ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should have correct vault configuration", async function () {
      expect(await vault.strategy()).to.equal(strategy.target);
      expect(await vault.asset()).to.equal(mockToken.target);
    });
  });

  describe("Investment via Vault", function () {
    it("Should invest in Compound V3 through vault deposit", async function () {
      // No need to encode Comet address anymore
      // Strategy will automatically find the right Comet for the asset

      // Deposit to vault
      const sharesBefore = await vault.balanceOf(user1.address);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const sharesAfter = await vault.balanceOf(user1.address);

      // Check shares minted
      expect(sharesAfter - sharesBefore).to.equal(DEPOSIT_AMOUNT);

      // Check Comet balance increased
      const cometBalance = await mockComet.balanceOf(vault.target);
      expect(cometBalance).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should handle multiple deposits with Compound V3 strategy", async function () {
      // First deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Second deposit
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT * 2n, user2.address);

      // Check balances
      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.balanceOf(user2.address)).to.equal(DEPOSIT_AMOUNT * 2n);

      // Check total Comet balance
      const cometBalance = await mockComet.balanceOf(vault.target);
      expect(cometBalance).to.equal(DEPOSIT_AMOUNT * 3n);
    });
  });

  describe("Withdrawal from Compound V3", function () {
    beforeEach(async function () {
      // Setup initial deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Should withdraw from Compound V3 through vault", async function () {
      const withdrawAmount = ethers.parseEther("500");
      const tokenBalanceBefore = await mockToken.balanceOf(user1.address);

      // Withdraw from vault
      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

      const tokenBalanceAfter = await mockToken.balanceOf(user1.address);
      expect(tokenBalanceAfter - tokenBalanceBefore).to.equal(withdrawAmount);

      // Check Comet balance decreased
      const cometBalance = await mockComet.balanceOf(vault.target);
      expect(cometBalance).to.equal(DEPOSIT_AMOUNT - withdrawAmount);
    });

    it("Should handle interest accrual", async function () {
      // Simulate interest accrual in Compound V3
      await mockComet.accrueInterest();

      // Since our mock doesn't actually distribute interest to balances,
      // we just check that totalAssets still works correctly
      const totalAssets = await vault.totalAssets();
      expect(totalAssets).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should withdraw all assets using max uint", async function () {
      await vault.connect(user1).withdraw(ethers.MaxUint256, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await mockComet.balanceOf(vault.target)).to.equal(0);
    });
  });

  describe("Error Cases", function () {
    it("Should revert with wrong asset for the Comet", async function () {
      // Deploy a token that's not the base token of the Comet
      const MockERC20Other = await ethers.getContractFactory("MockERC20");
      const wrongToken = await MockERC20Other.deploy("Wrong Token", "WRONG", 18);
      await wrongToken.waitForDeployment();

      // Deploy a vault with the wrong token
      const BolarityVault = await ethers.getContractFactory("BolarityVault");
      const wrongVault = await BolarityVault.deploy(
        wrongToken.target,
        "Wrong Vault",
        "bWRONG",
        strategy.target,
        feeCollector.address,
        PERFORMANCE_FEE_BPS
      );
      await wrongVault.waitForDeployment();

      // Mint and approve
      await wrongToken.mint(user1.address, DEPOSIT_AMOUNT);
      await wrongToken.connect(user1).approve(wrongVault.target, ethers.MaxUint256);
      
      // Try to deposit - should fail because asset doesn't match Comet's base token
      await expect(
        wrongVault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      ).to.be.revertedWith("BolarityVault: Strategy invest failed");
    });

    it("Should support multiple Comet markets", async function () {
      // Deploy another token and Comet
      const MockERC20Other = await ethers.getContractFactory("MockERC20");
      const otherToken = await MockERC20Other.deploy("Other Token", "OTHER", 18);
      await otherToken.waitForDeployment();

      const MockComet = await ethers.getContractFactory("MockComet");
      const otherComet = await MockComet.deploy(otherToken.target);
      await otherComet.waitForDeployment();
      
      // Add the new market to strategy
      await strategy.setCometMarket(otherToken.target, otherComet.target);
      
      // Check both markets are supported
      expect(await strategy.isAssetSupported(mockToken.target)).to.be.true;
      expect(await strategy.isAssetSupported(otherToken.target)).to.be.true;
      
      // Check Comet addresses
      expect(await strategy.getCometForAsset(mockToken.target)).to.equal(mockComet.target);
      expect(await strategy.getCometForAsset(otherToken.target)).to.equal(otherComet.target);
    });

    it("Should allow batch setting of Comet markets", async function () {
      // Deploy multiple tokens and Comets
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token1 = await MockERC20.deploy("Token 1", "TK1", 18);
      const token2 = await MockERC20.deploy("Token 2", "TK2", 18);
      await token1.waitForDeployment();
      await token2.waitForDeployment();

      const MockComet = await ethers.getContractFactory("MockComet");
      const comet1 = await MockComet.deploy(token1.target);
      const comet2 = await MockComet.deploy(token2.target);
      await comet1.waitForDeployment();
      await comet2.waitForDeployment();
      
      // Batch set markets
      await strategy.batchSetCometMarkets(
        [token1.target, token2.target],
        [comet1.target, comet2.target]
      );
      
      // Verify all markets are set
      expect(await strategy.getCometForAsset(token1.target)).to.equal(comet1.target);
      expect(await strategy.getCometForAsset(token2.target)).to.equal(comet2.target);
    });

    it("Should allow removing Comet markets", async function () {
      // First ensure the market exists
      expect(await strategy.isAssetSupported(mockToken.target)).to.be.true;
      
      // Remove the market
      await strategy.removeCometMarket(mockToken.target);
      
      // Check it's removed
      expect(await strategy.isAssetSupported(mockToken.target)).to.be.false;
      
      // Trying to get Comet for removed asset should revert
      await expect(
        strategy.getCometForAsset(mockToken.target)
      ).to.be.revertedWith("CompoundStrategy: Unsupported asset");
    });

    it("Should only allow owner to manage markets", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const newToken = await MockERC20.deploy("New Token", "NEW", 18);
      await newToken.waitForDeployment();

      const MockComet = await ethers.getContractFactory("MockComet");
      const newComet = await MockComet.deploy(newToken.target);
      await newComet.waitForDeployment();
      
      // Non-owner should not be able to set market
      await expect(
        strategy.connect(user1).setCometMarket(newToken.target, newComet.target)
      ).to.be.revertedWithCustomError(strategy, "OwnableUnauthorizedAccount");
      
      // Owner should be able to set market
      await strategy.connect(owner).setCometMarket(newToken.target, newComet.target);
      expect(await strategy.getCometForAsset(newToken.target)).to.equal(newComet.target);
    });
  });

  describe("Preview Functions", function () {
    it("Should correctly preview deposit", async function () {
      const previewShares = await vault.previewDeposit(DEPOSIT_AMOUNT);
      expect(previewShares).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should correctly preview withdraw after deposit", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      const withdrawAmount = ethers.parseEther("500");
      const previewShares = await vault.previewWithdraw(withdrawAmount);
      expect(previewShares).to.be.greaterThan(0);
    });
  });

  describe("Emergency Withdraw", function () {
    it("Should handle emergency withdrawal of specific amount", async function () {
      // Deposit first
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Get balance before emergency withdraw
      const vaultCometBalanceBefore = await mockComet.balanceOf(vault.target);
      expect(vaultCometBalanceBefore).to.equal(DEPOSIT_AMOUNT);

      // Emergency withdraw specific amount (only owner can do this)
      // Call with explicit signature
      await vault.connect(owner)["emergencyWithdraw(uint256)"](DEPOSIT_AMOUNT / 2n);

      // Check that vault's Comet balance decreased
      const vaultCometBalanceAfter = await mockComet.balanceOf(vault.target);
      expect(vaultCometBalanceAfter).to.equal(DEPOSIT_AMOUNT / 2n);
    });

    it("Should handle full emergency withdrawal", async function () {
      // Deposit first
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Emergency withdraw all (only owner can do this)
      // Call with explicit signature
      await vault.connect(owner)["emergencyWithdraw()"]();

      // Check that all funds are withdrawn from Comet
      const vaultCometBalance = await mockComet.balanceOf(vault.target);
      expect(vaultCometBalance).to.equal(0);
      
      // Check vault has the funds
      const vaultTokenBalance = await mockToken.balanceOf(vault.target);
      expect(vaultTokenBalance).to.equal(DEPOSIT_AMOUNT);
    });
  });

  describe("Strategy Properties", function () {
    it("Should have correct owner", async function () {
      expect(await strategy.owner()).to.equal(owner.address);
    });

    it("Should get supported assets", async function () {
      const supportedAssets = await strategy.getSupportedAssets();
      expect(supportedAssets.length).to.equal(1);
      expect(supportedAssets[0]).to.equal(mockToken.target);
    });

    it("Should get supported assets count", async function () {
      expect(await strategy.getSupportedAssetsCount()).to.equal(1);
      
      // Add another market
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const newToken = await MockERC20.deploy("New Token", "NEW", 18);
      await newToken.waitForDeployment();
      
      const MockComet = await ethers.getContractFactory("MockComet");
      const newComet = await MockComet.deploy(newToken.target);
      await newComet.waitForDeployment();
      
      await strategy.setCometMarket(newToken.target, newComet.target);
      expect(await strategy.getSupportedAssetsCount()).to.equal(2);
    });

    it("Should calculate total underlying correctly", async function () {
      // Initially should be 0
      expect(await strategy.totalUnderlying(vault.target)).to.equal(0);
      
      // After deposit
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      expect(await strategy.totalUnderlying(vault.target)).to.equal(DEPOSIT_AMOUNT);
    });

  });
});