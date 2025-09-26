import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BolarityVault, WstETHStrategy } from "../typechain-types";
import { Contract } from "ethers";

describe("WstETHStrategy", function () {
  let vault: BolarityVault;
  let strategy: WstETHStrategy;
  let mockStETH: Contract;
  let mockWstETH: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("1000000");
  const DEPOSIT_AMOUNT = ethers.parseEther("10"); // 10 stETH
  const PERFORMANCE_FEE_BPS = 1000; // 10%

  beforeEach(async function () {
    [owner, user1, user2, feeCollector] = await ethers.getSigners();

    // Deploy Mock stETH
    const MockStETH = await ethers.getContractFactory("MockStETH");
    mockStETH = await MockStETH.deploy();
    await mockStETH.waitForDeployment();

    // Deploy Mock wstETH
    const MockWstETH = await ethers.getContractFactory("MockWstETH");
    mockWstETH = await MockWstETH.deploy(mockStETH.target);
    await mockWstETH.waitForDeployment();

    // Deploy WstETHStrategy
    const WstETHStrategy = await ethers.getContractFactory("WstETHStrategy");
    strategy = await WstETHStrategy.deploy(mockWstETH.target);
    await strategy.waitForDeployment();

    // Deploy BolarityVault with WstETHStrategy
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockStETH.target,
      "Bolarity wstETH Vault",
      "bwstETH",
      strategy.target,
      owner.address, // router
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Mint stETH to users for testing
    await mockStETH.mint(user1.address, INITIAL_BALANCE);
    await mockStETH.mint(user2.address, INITIAL_BALANCE);

    // Approve vault to spend stETH
    await mockStETH.connect(user1).approve(vault.target, ethers.MaxUint256);
    await mockStETH.connect(user2).approve(vault.target, ethers.MaxUint256);
    
    // Authorize users to call vault directly for testing
    await vault.connect(owner).setAuthorizedCaller(user1.address, true);
    await vault.connect(owner).setAuthorizedCaller(user2.address, true);
  });

  describe("Deployment", function () {
    it("Should set the correct wstETH and stETH addresses", async function () {
      expect(await strategy.wstETH()).to.equal(mockWstETH.target);
      expect(await strategy.stETH()).to.equal(mockStETH.target);
    });

    it("Should have correct vault configuration", async function () {
      expect(await vault.strategy()).to.equal(strategy.target);
      expect(await vault.asset()).to.equal(mockStETH.target);
    });
  });

  describe("Investment via Vault (No Entry Gain)", function () {
    it("Should wrap stETH to wstETH through vault deposit", async function () {
      // No strategy data needed for wstETH
      const strategyData = "0x";
      // Deposit to vault with strategy data
      const sharesBefore = await vault.balanceOf(user1.address);
      await vault.connect(user1).depositWithData(DEPOSIT_AMOUNT, user1.address, strategyData);
      const sharesAfter = await vault.balanceOf(user1.address);

      // Check shares minted (should equal deposit amount as no entry gain)
      expect(sharesAfter - sharesBefore).to.equal(DEPOSIT_AMOUNT);

      // Check wstETH balance of vault increased
      const wstETHBalance = await mockWstETH.balanceOf(vault.target);
      expect(wstETHBalance).to.be.greaterThan(0);

      // No fee should be collected as there's no entry gain
      expect(await vault.balanceOf(feeCollector.address)).to.equal(0);
    });

    it("Should handle multiple deposits without entry gain", async function () {
      const strategyData = "0x";

      // First deposit
      await vault.connect(user1).depositWithData(DEPOSIT_AMOUNT, user1.address, strategyData);

      // Second deposit
      await vault.connect(user2).depositWithData(DEPOSIT_AMOUNT * 2n, user2.address, strategyData);

      // Check balances (should equal deposits as no entry gain)
      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.balanceOf(user2.address)).to.equal(DEPOSIT_AMOUNT * 2n);

      // Total wstETH balance
      const wstETHBalance = await mockWstETH.balanceOf(vault.target);
      expect(wstETHBalance).to.be.greaterThan(0);

      // No fees collected (no entry gain)
      expect(await vault.balanceOf(feeCollector.address)).to.equal(0);
    });
  });

  describe("Withdrawal from wstETH", function () {
    beforeEach(async function () {
      // Setup initial deposit
      const strategyData = "0x";
      await vault.connect(user1).depositWithData(DEPOSIT_AMOUNT, user1.address, strategyData);
    });

    it("Should unwrap wstETH to stETH through vault withdrawal", async function () {
      const strategyData = "0x";
      const withdrawAmount = ethers.parseEther("5");
      const stETHBalanceBefore = await mockStETH.balanceOf(user1.address);

      // Withdraw with strategy data
      await vault.connect(user1).withdrawWithData(withdrawAmount, user1.address, user1.address, strategyData);

      const stETHBalanceAfter = await mockStETH.balanceOf(user1.address);
      expect(stETHBalanceAfter - stETHBalanceBefore).to.equal(withdrawAmount);
    });

    it("Should handle stETH appreciation", async function () {
      // Simulate stETH appreciation (5% increase in stETH per wstETH)
      await mockWstETH.increaseStEthPerToken(5);

      // Total assets should reflect the increased value
      const totalAssets = await vault.totalAssets();
      expect(totalAssets).to.be.greaterThan(DEPOSIT_AMOUNT);

      // User should be able to withdraw more than deposited
      const strategyData = "0x";
      
      const stETHBalanceBefore = await mockStETH.balanceOf(user1.address);
      await vault.connect(user1).withdrawWithData(ethers.MaxUint256, user1.address, user1.address, strategyData);
      const stETHBalanceAfter = await mockStETH.balanceOf(user1.address);
      
      const withdrawn = stETHBalanceAfter - stETHBalanceBefore;
      expect(withdrawn).to.be.greaterThan(DEPOSIT_AMOUNT);
    });

    it("Should withdraw all assets using max uint", async function () {
      const strategyData = "0x";
      await vault.connect(user1).withdrawWithData(ethers.MaxUint256, user1.address, user1.address, strategyData);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await mockWstETH.balanceOf(vault.target)).to.equal(0);
    });
  });

  describe("Redeem Functionality", function () {
    beforeEach(async function () {
      const strategyData = "0x";
      await vault.connect(user1).depositWithData(DEPOSIT_AMOUNT, user1.address, strategyData);
    });

    it("Should redeem shares for stETH", async function () {
      const shares = await vault.balanceOf(user1.address);
      const stETHBalanceBefore = await mockStETH.balanceOf(user1.address);

      const strategyData = "0x";
      await vault.connect(user1).redeemWithData(shares, user1.address, user1.address, strategyData);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      const stETHBalanceAfter = await mockStETH.balanceOf(user1.address);
      expect(stETHBalanceAfter - stETHBalanceBefore).to.be.closeTo(DEPOSIT_AMOUNT, ethers.parseEther("0.01"));
    });
  });

  describe("Error Cases", function () {
    it("Should revert when asset is not stETH", async function () {
      // Deploy vault with wrong asset
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const wrongToken = await MockERC20.deploy("Wrong Token", "WRONG", 18);
      await wrongToken.waitForDeployment();

      const BolarityVault = await ethers.getContractFactory("BolarityVault");
      const wrongVault = await BolarityVault.deploy(
        wrongToken.target,
        "Wrong Vault",
        "bWRONG",
        strategy.target,
        owner.address, // router
      feeCollector.address,
        PERFORMANCE_FEE_BPS
      );
      await wrongVault.waitForDeployment();

      await wrongToken.mint(user1.address, DEPOSIT_AMOUNT);
      await wrongToken.connect(user1).approve(wrongVault.target, ethers.MaxUint256);
      
      // Authorize user to call vault directly for testing
      await wrongVault.connect(owner).setAuthorizedCaller(user1.address, true);

      await expect(
        wrongVault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      ).to.be.revertedWith("WstETHStrategy: Asset must be stETH");
    });
  });

  describe("Preview Functions", function () {
    it("Should correctly preview deposit", async function () {
      const previewShares = await vault.previewDeposit(DEPOSIT_AMOUNT);
      // For wstETH, no entry gain, so shares = assets
      expect(previewShares).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should correctly preview mint", async function () {
      const shares = ethers.parseEther("5");
      const previewAssets = await vault.previewMint(shares);
      // For first mint, assets = shares
      expect(previewAssets).to.equal(shares);
    });

    it("Should correctly preview withdraw after deposit", async function () {
      const strategyData = "0x";
      await vault.connect(user1).depositWithData(DEPOSIT_AMOUNT, user1.address, strategyData);

      const withdrawAmount = ethers.parseEther("5");
      const previewShares = await vault.previewWithdraw(withdrawAmount);
      expect(previewShares).to.equal(withdrawAmount);
    });

    it("Should correctly preview redeem after deposit", async function () {
      const strategyData = "0x";
      await vault.connect(user1).depositWithData(DEPOSIT_AMOUNT, user1.address, strategyData);

      const shares = ethers.parseEther("5");
      const previewAssets = await vault.previewRedeem(shares);
      expect(previewAssets).to.equal(shares);
    });
  });

  describe("Total Assets Calculation", function () {
    it("Should correctly calculate total assets with wstETH", async function () {
      const strategyData = "0x";
      await vault.connect(user1).depositWithData(DEPOSIT_AMOUNT, user1.address, strategyData);

      const totalAssets = await vault.totalAssets();
      expect(totalAssets).to.equal(DEPOSIT_AMOUNT);

      // After stETH appreciation
      await mockWstETH.increaseStEthPerToken(10); // 10% increase
      const totalAssetsAfter = await vault.totalAssets();
      expect(totalAssetsAfter).to.be.greaterThan(totalAssets);
    });
  });
});