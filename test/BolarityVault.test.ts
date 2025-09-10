import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BolarityVault } from "../typechain-types";
import { Contract } from "ethers";

describe("BolarityVault", function () {
  let vault: BolarityVault;
  let mockToken: Contract;
  let mockAavePool: Contract;
  let mockStrategy: Contract;
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
    mockToken = await MockERC20.deploy("Mock Token", "MOCK", 18);
    await mockToken.waitForDeployment();

    // Deploy Mock Aave Pool (simulates Aave pool)
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAavePool = await MockAavePool.deploy();
    await mockAavePool.waitForDeployment();

    // Deploy Mock Strategy with pool address
    const MockStrategy = await ethers.getContractFactory("MockStrategy");
    mockStrategy = await MockStrategy.deploy(mockAavePool.target);
    await mockStrategy.waitForDeployment();

    // Deploy BolarityVault
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockToken.target,
      "Bolarity Mock Vault",
      "bMOCK",
      mockStrategy.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Mint tokens to users for testing
    await mockToken.mint(user1.address, INITIAL_BALANCE);
    await mockToken.mint(user2.address, INITIAL_BALANCE);

    // Approve vault to spend tokens
    await mockToken.connect(user1).approve(vault.target, ethers.MaxUint256);
    await mockToken.connect(user2).approve(vault.target, ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct asset", async function () {
      expect(await vault.asset()).to.equal(mockToken.target);
    });

    it("Should set the correct strategy", async function () {
      expect(await vault.strategy()).to.equal(mockStrategy.target);
    });

    it("Should set the correct fee collector", async function () {
      expect(await vault.feeCollector()).to.equal(feeCollector.address);
    });

    it("Should set the correct performance fee", async function () {
      expect(await vault.perfFeeBps()).to.equal(PERFORMANCE_FEE_BPS);
    });

    it("Should set the correct name and symbol", async function () {
      expect(await vault.name()).to.equal("Bolarity Mock Vault");
      expect(await vault.symbol()).to.equal("bMOCK");
    });

    it("Should set the correct owner", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });
  });

  describe("Deposit", function () {
    it("Should deposit assets and mint shares", async function () {
      const sharesBefore = await vault.balanceOf(user1.address);
      
      await expect(vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address))
        .to.emit(vault, "Deposit")
        .withArgs(user1.address, user1.address, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT);

      const sharesAfter = await vault.balanceOf(user1.address);
      expect(sharesAfter - sharesBefore).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should handle multiple deposits correctly", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT, user2.address);

      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.balanceOf(user2.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.totalSupply()).to.equal(DEPOSIT_AMOUNT * 2n);
    });

    it("Should revert when paused", async function () {
      await vault.pause();
      
      await expect(
        vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address)
      ).to.be.revertedWith("BolarityVault: Paused");
    });
  });

  describe("Mint", function () {
    it("Should mint shares and pull assets", async function () {
      const shares = ethers.parseEther("100");
      
      await expect(vault.connect(user1).mint(shares, user1.address))
        .to.emit(vault, "Deposit");

      expect(await vault.balanceOf(user1.address)).to.equal(shares);
    });

    it("Should revert when paused", async function () {
      await vault.pause();
      
      await expect(
        vault.connect(user1).mint(ethers.parseEther("100"), user1.address)
      ).to.be.revertedWith("BolarityVault: Paused");
    });
  });

  describe("Withdraw", function () {
    beforeEach(async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Should withdraw assets and burn shares", async function () {
      const withdrawAmount = ethers.parseEther("500");
      
      await expect(vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address))
        .to.emit(vault, "Withdraw");

      expect(await vault.balanceOf(user1.address)).to.be.lessThan(DEPOSIT_AMOUNT);
    });

    it("Should withdraw all assets when passing type(uint256).max", async function () {
      // Get initial balances
      const sharesBefore = await vault.balanceOf(user1.address);
      const tokenBalanceBefore = await mockToken.balanceOf(user1.address);
      
      // Withdraw all using max uint256 value
      await expect(vault.connect(user1).withdraw(ethers.MaxUint256, user1.address, user1.address))
        .to.emit(vault, "Withdraw");
      
      // Check that all shares are burned
      const sharesAfter = await vault.balanceOf(user1.address);
      expect(sharesAfter).to.equal(0);
      
      // Check that user received tokens back
      const tokenBalanceAfter = await mockToken.balanceOf(user1.address);
      expect(tokenBalanceAfter).to.be.greaterThan(tokenBalanceBefore);
      
      // Should have received approximately the deposited amount (minus any fees)
      const tokensReceived = tokenBalanceAfter - tokenBalanceBefore;
      expect(tokensReceived).to.be.closeTo(DEPOSIT_AMOUNT, ethers.parseEther("0.01"));
    });

    it("Should handle multiple users withdrawing all assets", async function () {
      // User2 also deposits
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT * 2n, user2.address);
      
      // Both users have shares
      expect(await vault.balanceOf(user1.address)).to.equal(DEPOSIT_AMOUNT);
      expect(await vault.balanceOf(user2.address)).to.equal(DEPOSIT_AMOUNT * 2n);
      
      // User1 withdraws all
      await vault.connect(user1).withdraw(ethers.MaxUint256, user1.address, user1.address);
      expect(await vault.balanceOf(user1.address)).to.equal(0);
      
      // User2 can still withdraw all their assets
      const user2TokensBefore = await mockToken.balanceOf(user2.address);
      await vault.connect(user2).withdraw(ethers.MaxUint256, user2.address, user2.address);
      
      // User2 should have no shares left
      expect(await vault.balanceOf(user2.address)).to.equal(0);
      
      // User2 should have received their tokens
      const user2TokensAfter = await mockToken.balanceOf(user2.address);
      const tokensReceived = user2TokensAfter - user2TokensBefore;
      expect(tokensReceived).to.be.closeTo(DEPOSIT_AMOUNT * 2n, ethers.parseEther("0.02"));
    });

    it("Should divest funds from strategy", async function () {
      const withdrawAmount = ethers.parseEther("500");
      const strategyBalanceBefore = await mockToken.balanceOf(mockStrategy.target);
      
      await vault.connect(user1).withdraw(withdrawAmount, user1.address, user1.address);
      
      const strategyBalanceAfter = await mockToken.balanceOf(mockStrategy.target);
      expect(strategyBalanceBefore - strategyBalanceAfter).to.be.greaterThanOrEqual(0);
    });

    it("Should revert when paused", async function () {
      await vault.pause();
      
      await expect(
        vault.connect(user1).withdraw(ethers.parseEther("500"), user1.address, user1.address)
      ).to.be.revertedWith("BolarityVault: Paused");
    });

    it("Should revert if insufficient balance", async function () {
      await expect(
        vault.connect(user1).withdraw(DEPOSIT_AMOUNT * 2n, user1.address, user1.address)
      ).to.be.reverted;
    });
  });

  describe("Redeem", function () {
    beforeEach(async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Should redeem shares for assets", async function () {
      const shares = await vault.balanceOf(user1.address);
      const tokenBalanceBefore = await mockToken.balanceOf(user1.address);
      
      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      const tokenBalanceAfter = await mockToken.balanceOf(user1.address);
      expect(tokenBalanceAfter).to.be.greaterThan(tokenBalanceBefore);
    });

    it("Should revert when paused", async function () {
      await vault.pause();
      const shares = await vault.balanceOf(user1.address);
      
      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.be.revertedWith("BolarityVault: Paused");
    });
  });

  describe("Performance Fee", function () {
    it("Should accrue performance fee on profit", async function () {
      // User deposits
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      // Simulate profit by sending tokens to vault (not strategy, as strategy uses delegatecall)
      await mockToken.mint(vault.target, ethers.parseEther("100"));

      // Another deposit should trigger fee accrual
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT, user2.address);

      // Fee collector should have received shares
      const feeCollectorBalance = await vault.balanceOf(feeCollector.address);
      expect(feeCollectorBalance).to.be.greaterThan(0);
    });

    it("Should emit FeeCrystallized event", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      await mockToken.mint(vault.target, ethers.parseEther("100"));

      await expect(vault.connect(user2).deposit(DEPOSIT_AMOUNT, user2.address))
        .to.emit(vault, "FeeCrystallized");
    });

    it("Should not accrue fee when there's no profit", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // No profit added
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT, user2.address);

      const feeCollectorBalance = await vault.balanceOf(feeCollector.address);
      expect(feeCollectorBalance).to.equal(0);
    });
  });

  describe("Strategy Management", function () {
    it("Should allow owner to change strategy", async function () {
      const MockStrategy = await ethers.getContractFactory("MockStrategy");
      const newStrategy = await MockStrategy.deploy(mockAavePool.target);
      await newStrategy.waitForDeployment();

      await expect(vault.setStrategy(newStrategy.target))
        .to.emit(vault, "StrategyChanged")
        .withArgs(mockStrategy.target, newStrategy.target);

      expect(await vault.strategy()).to.equal(newStrategy.target);
    });

    it("Should migrate funds when changing strategy", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      const MockStrategy = await ethers.getContractFactory("MockStrategy");
      const newStrategy = await MockStrategy.deploy(mockAavePool.target);
      await newStrategy.waitForDeployment();

      const vaultBalanceBefore = await mockToken.balanceOf(vault.target);
      await vault.setStrategy(newStrategy.target);

      // Verify funds remain in vault (since strategies use delegatecall)
      expect(await mockToken.balanceOf(vault.target)).to.equal(vaultBalanceBefore);
    });

    it("Should revert if non-owner tries to change strategy", async function () {
      await expect(
        vault.connect(user1).setStrategy(user2.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("Should revert with zero address strategy", async function () {
      await expect(
        vault.setStrategy(ethers.ZeroAddress)
      ).to.be.revertedWith("BolarityVault: Invalid strategy");
    });
  });

  describe("Fee Management", function () {
    it("Should allow owner to update performance fee", async function () {
      const newFee = 2000; // 20%
      await vault.setPerfFeeBps(newFee);
      expect(await vault.perfFeeBps()).to.equal(newFee);
    });

    it("Should revert if fee is too high", async function () {
      const invalidFee = 3001; // > 30%
      await expect(
        vault.setPerfFeeBps(invalidFee)
      ).to.be.revertedWith("BolarityVault: Fee too high");
    });

    it("Should allow owner to change fee collector", async function () {
      await vault.setFeeCollector(user2.address);
      expect(await vault.feeCollector()).to.equal(user2.address);
    });

    it("Should revert with zero address fee collector", async function () {
      await expect(
        vault.setFeeCollector(ethers.ZeroAddress)
      ).to.be.revertedWith("BolarityVault: Invalid collector");
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause", async function () {
      await expect(vault.pause())
        .to.emit(vault, "Paused")
        .withArgs(owner.address);

      expect(await vault.paused()).to.be.true;
    });

    it("Should allow owner to unpause", async function () {
      await vault.pause();
      
      await expect(vault.unpause())
        .to.emit(vault, "Unpaused")
        .withArgs(owner.address);

      expect(await vault.paused()).to.be.false;
    });

    it("Should revert if non-owner tries to pause", async function () {
      await expect(
        vault.connect(user1).pause()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Emergency Withdraw", function () {
    it("Should allow owner to emergency withdraw", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);

      const vaultBalanceBefore = await mockToken.balanceOf(vault.target);
      const poolBalanceBefore = await mockToken.balanceOf(mockAavePool.target);

      // After deposit, funds should be in the pool, not the vault
      expect(vaultBalanceBefore).to.equal(0);
      expect(poolBalanceBefore).to.equal(DEPOSIT_AMOUNT);

      // Emergency withdraw should bring funds back from pool to vault
      await vault["emergencyWithdraw(uint256)"](DEPOSIT_AMOUNT);

      const vaultBalanceAfter = await mockToken.balanceOf(vault.target);
      const poolBalanceAfter = await mockToken.balanceOf(mockAavePool.target);

      // Funds should return to vault after emergency withdraw
      expect(vaultBalanceAfter).to.equal(DEPOSIT_AMOUNT);
      expect(poolBalanceAfter).to.equal(0);
    });

    it("Should revert if non-owner tries emergency withdraw", async function () {
      await expect(
        vault.connect(user1)["emergencyWithdraw(uint256)"](DEPOSIT_AMOUNT)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Preview Functions", function () {
    beforeEach(async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
    });

    it("Should preview deposit correctly", async function () {
      const assets = ethers.parseEther("100");
      const shares = await vault.previewDeposit(assets);
      expect(shares).to.be.greaterThan(0);
    });

    it("Should preview mint correctly", async function () {
      const shares = ethers.parseEther("100");
      const assets = await vault.previewMint(shares);
      expect(assets).to.be.greaterThan(0);
    });

    it("Should preview withdraw correctly", async function () {
      const assets = ethers.parseEther("100");
      const shares = await vault.previewWithdraw(assets);
      expect(shares).to.be.greaterThan(0);
    });

    it("Should preview redeem correctly", async function () {
      const shares = ethers.parseEther("100");
      const assets = await vault.previewRedeem(shares);
      expect(assets).to.be.greaterThan(0);
    });
  });

  describe("Total Assets", function () {
    it("Should return correct total assets", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      await vault.connect(user2).deposit(DEPOSIT_AMOUNT, user2.address);

      const totalAssets = await vault.totalAssets();
      expect(totalAssets).to.equal(DEPOSIT_AMOUNT * 2n);
    });

    it("Should include both idle and invested assets", async function () {
      await vault.connect(user1).deposit(DEPOSIT_AMOUNT, user1.address);
      
      // Simulate some idle balance
      await mockToken.mint(vault.target, ethers.parseEther("100"));

      const totalAssets = await vault.totalAssets();
      expect(totalAssets).to.equal(DEPOSIT_AMOUNT + ethers.parseEther("100"));
    });
  });
});