import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BolarityVault, CompoundStrategy } from "../typechain-types";
import { Contract } from "ethers";

describe("CompoundStrategy", function () {
  let vault: BolarityVault;
  let strategy: CompoundStrategy;
  let mockToken: Contract;
  let mockCToken: Contract;
  let mockComptroller: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("1000000");
  const DEPOSIT_AMOUNT = ethers.parseEther("1000");
  const PERFORMANCE_FEE_BPS = 1000; // 10%

  beforeEach(async function () {
    [owner, user1, user2, feeCollector] = await ethers.getSigners();

    // Deploy Mock ERC20 Token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "USDC", 18);
    await mockToken.waitForDeployment();

    // Deploy Mock Comptroller
    const MockComptroller = await ethers.getContractFactory("MockComptroller");
    mockComptroller = await MockComptroller.deploy();
    await mockComptroller.waitForDeployment();

    // Deploy Mock cToken
    const MockCToken = await ethers.getContractFactory("MockCToken");
    mockCToken = await MockCToken.deploy(mockToken.target, "Compound USDC", "cUSDC");
    await mockCToken.waitForDeployment();

    // Deploy CompoundStrategy
    const CompoundStrategy = await ethers.getContractFactory("CompoundStrategy");
    strategy = await CompoundStrategy.deploy(mockComptroller.target);
    await strategy.waitForDeployment();

    // Deploy BolarityVault with CompoundStrategy
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockToken.target,
      "Bolarity Compound Vault",
      "bCOMP",
      strategy.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Mint tokens to users and vault for testing
    await mockToken.mint(user1.address, INITIAL_BALANCE);
    await mockToken.mint(user2.address, INITIAL_BALANCE);
    await mockToken.mint(mockCToken.target, INITIAL_BALANCE); // Fund cToken for redemptions

    // Approve vault to spend tokens
    await mockToken.connect(user1).approve(vault.target, ethers.MaxUint256);
    await mockToken.connect(user2).approve(vault.target, ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct comptroller", async function () {
      expect(await strategy.comptroller()).to.equal(mockComptroller.target);
    });

    it("Should have correct vault configuration", async function () {
      expect(await vault.strategy()).to.equal(strategy.target);
      expect(await vault.asset()).to.equal(mockToken.target);
    });
  });

  describe("Investment via Vault", function () {
    it("Should invest in Compound through vault deposit", async function () {
      // Encode cToken address for strategy data
      const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [mockCToken.target]
      );

      // Set strategy data before deposit
      await vault.setStrategyCallData(strategyData);

      // Deposit to vault
      const sharesBefore = await vault.balanceOf(user1.address);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      const sharesAfter = await vault.balanceOf(user1.address);

      // Check shares minted
      expect(sharesAfter - sharesBefore).to.equal(DEPOSIT_AMOUNT);

      // Check cToken balance increased
      const cTokenBalance = await mockCToken.balanceOf(vault.target);
      expect(cTokenBalance).to.be.greaterThan(0);
    });

    it("Should handle multiple deposits with Compound strategy", async function () {
      const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [mockCToken.target]
      );

      // First deposit
      await vault.setStrategyCallData(strategyData);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Second deposit
      await vault.setStrategyCallData(strategyData);
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT * 2n, user2.address);

      // Check balances
      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.balanceOf(user2.address)).to.equal(DEPOSIT_AMOUNT * 2n);

      // Check total cToken balance
      const cTokenBalance = await mockCToken.balanceOf(vault.target);
      expect(cTokenBalance).to.be.greaterThan(0);
    });
  });

  describe("Withdrawal from Compound", function () {
    beforeEach(async function () {
      // Setup initial deposit
      const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [mockCToken.target]
      );
      await vault.setStrategyCallData(strategyData);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Should withdraw from Compound through vault", async function () {
      const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [mockCToken.target]
      );

      const withdrawAmount = ethers.parseEther("500");
      const tokenBalanceBefore = await mockToken.balanceOf(user1.address);

      // Set strategy data for withdrawal
      await vault.setStrategyCallData(strategyData);
      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);

      const tokenBalanceAfter = await mockToken.balanceOf(user1.address);
      expect(tokenBalanceAfter - tokenBalanceBefore).to.equal(withdrawAmount);
    });

    it("Should handle interest accrual", async function () {
      // Simulate interest accrual in Compound
      await mockCToken.accrueInterest();

      // Total assets should reflect the increased value
      const totalAssets = await vault.totalAssets();
      expect(totalAssets).to.be.greaterThan(DEPOSIT_AMOUNT);
    });

    it("Should withdraw all assets using max uint", async function () {
      const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [mockCToken.target]
      );

      await vault.setStrategyCallData(strategyData);
      await vault.connect(user1).withdraw(ethers.MaxUint256, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });
  });

  describe("Error Cases", function () {
    it("Should revert with invalid cToken address", async function () {
      const invalidData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [ethers.ZeroAddress]
      );

      await vault.setStrategyCallData(invalidData);
      
      await expect(
        vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      ).to.be.revertedWith("BolarityVault: Strategy invest failed");
    });

    it("Should revert with mismatched underlying asset", async function () {
      // Deploy a cToken with different underlying
      const MockERC20Other = await ethers.getContractFactory("MockERC20");
      const otherToken = await MockERC20Other.deploy("Other Token", "OTHER", 18);
      await otherToken.waitForDeployment();

      const MockCToken = await ethers.getContractFactory("MockCToken");
      const wrongCToken = await MockCToken.deploy(otherToken.target, "Wrong cToken", "cWRONG");
      await wrongCToken.waitForDeployment();

      const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [wrongCToken.target]
      );

      await vault.setStrategyCallData(strategyData);
      
      await expect(
        vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      ).to.be.revertedWith("BolarityVault: Strategy invest failed");
    });
  });

  describe("Preview Functions", function () {
    it("Should correctly preview deposit", async function () {
      const previewShares = await vault.previewDeposit(DEPOSIT_AMOUNT);
      expect(previewShares).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should correctly preview withdraw after deposit", async function () {
      const strategyData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [mockCToken.target]
      );
      await vault.setStrategyCallData(strategyData);
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      const withdrawAmount = ethers.parseEther("500");
      const previewShares = await vault.previewWithdraw(withdrawAmount);
      expect(previewShares).to.be.greaterThan(0);
    });
  });
});