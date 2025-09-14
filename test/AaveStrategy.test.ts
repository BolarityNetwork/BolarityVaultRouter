import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  AaveStrategy,
  TestAaveStrategy,
  MockERC20,
  MockAavePool,
  MockAToken,
  BolarityVault
} from "../typechain-types";

describe("AaveStrategy", function () {
  let aaveStrategy: AaveStrategy;
  let testStrategy: TestAaveStrategy;
  let mockToken: MockERC20;
  let mockAavePool: MockAavePool;
  let mockAToken: MockAToken;
  let vault: BolarityVault;
  let vaultWithProdStrategy: BolarityVault;
  
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("10000");
  const DEPOSIT_AMOUNT = ethers.parseEther("1000");
  const PERFORMANCE_FEE_BPS = 1000; // 10%

  beforeEach(async function () {
    [owner, user, feeCollector] = await ethers.getSigners();

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

    // Deploy AaveStrategy with pool address
    const AaveStrategy = await ethers.getContractFactory("AaveStrategy");
    aaveStrategy = await AaveStrategy.deploy(mockAavePool.target, poolDataProviderAddress);
    await aaveStrategy.waitForDeployment();
    
    // Deploy TestAaveStrategy for testing (with totalUnderlying support)
    const TestAaveStrategy = await ethers.getContractFactory("TestAaveStrategy");
    testStrategy = await TestAaveStrategy.deploy(mockAavePool.target, poolDataProviderAddress);
    await testStrategy.waitForDeployment();

    // Deploy BolarityVault with TestAaveStrategy for testing
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockToken.target,
      "Bolarity Aave Vault",
      "bAAVE",
      testStrategy.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();
    
    // Deploy another vault with production AaveStrategy
    vaultWithProdStrategy = await BolarityVault.deploy(
      mockToken.target,
      "Bolarity Aave Vault Prod",
      "bAAVEP",
      aaveStrategy.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vaultWithProdStrategy.waitForDeployment();

    // Mint tokens to user
    await mockToken.mint(user.address, INITIAL_BALANCE);

    // Approve vault to spend tokens
    await mockToken.connect(user).approve(vault.target, ethers.MaxUint256);
    await mockToken.connect(user).approve(vaultWithProdStrategy.target, ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct Aave pool", async function () {
      expect(await aaveStrategy.aavePool()).to.equal(mockAavePool.target);
      expect(await testStrategy.aavePool()).to.equal(mockAavePool.target);
    });

    it("Should revert with zero pool address", async function () {
      const AaveStrategy = await ethers.getContractFactory("AaveStrategy");
      await expect(
        AaveStrategy.deploy(ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWith("AaveStrategy: Invalid pool");
    });
    
    it("Should revert with zero data provider address", async function () {
      const AaveStrategy = await ethers.getContractFactory("AaveStrategy");
      await expect(
        AaveStrategy.deploy(mockAavePool.target, ethers.ZeroAddress)
      ).to.be.revertedWith("AaveStrategy: Invalid data provider");
    });
  });

  describe("Integration with Vault", function () {
    it("Should invest funds when depositing to vault", async function () {
      // Deposit to vault
      await vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);

      // Check that funds were sent to aToken contract
      const aTokenBalance = await mockToken.balanceOf(mockAToken.target);
      expect(aTokenBalance).to.equal(DEPOSIT_AMOUNT);

      // Check vault has no idle funds
      const vaultBalance = await mockToken.balanceOf(vault.target);
      expect(vaultBalance).to.equal(0);
    });

    it("Should withdraw funds when withdrawing from vault", async function () {
      // First deposit
      await vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);

      // Then withdraw half
      const withdrawAmount = DEPOSIT_AMOUNT / 2n;
      await vault.connect(user).withdraw(withdrawAmount, user.address, user.address);

      // Check user received funds
      const userBalance = await mockToken.balanceOf(user.address);
      expect(userBalance).to.equal(INITIAL_BALANCE - DEPOSIT_AMOUNT + withdrawAmount);

      // Check aToken balance decreased
      const aTokenBalance = await mockToken.balanceOf(mockAToken.target);
      expect(aTokenBalance).to.equal(DEPOSIT_AMOUNT - withdrawAmount);
    });

    it("Should handle multiple deposits and withdrawals", async function () {
      // Multiple deposits
      const deposit1 = ethers.parseEther("500");
      const deposit2 = ethers.parseEther("300");
      
      await vault.connect(user).deposit(deposit1, user.address);
      await vault.connect(user).deposit(deposit2, user.address);

      // Check total in aToken
      let aTokenBalance = await mockToken.balanceOf(mockAToken.target);
      expect(aTokenBalance).to.equal(deposit1 + deposit2);

      // Withdraw some
      const withdraw1 = ethers.parseEther("200");
      await vault.connect(user).withdraw(withdraw1, user.address, user.address);

      aTokenBalance = await mockToken.balanceOf(mockAToken.target);
      expect(aTokenBalance).to.equal(deposit1 + deposit2 - withdraw1);
    });

    it("Should handle emergency withdraw", async function () {
      // Deposit first
      await vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);

      // Emergency withdraw with specific amount
      await vault["emergencyWithdraw(uint256)"](DEPOSIT_AMOUNT);

      // Check vault received funds back
      const vaultBalance = await mockToken.balanceOf(vault.target);
      expect(vaultBalance).to.equal(DEPOSIT_AMOUNT);

      // Check aToken balance is zero
      const aTokenBalance = await mockToken.balanceOf(mockAToken.target);
      expect(aTokenBalance).to.equal(0);
    });
  });

  describe("totalUnderlying", function () {
    it("AaveStrategy should return 0 when no aTokens minted", async function () {
      // Initially should be 0
      const total = await aaveStrategy.totalUnderlying(vaultWithProdStrategy.target);
      expect(total).to.equal(0);
    });
    
    it("AaveStrategy should return correct totalUnderlying via aToken balance", async function () {
      // Deposit to vault with production strategy
      await vaultWithProdStrategy.connect(user).deposit(DEPOSIT_AMOUNT, user.address);
      
      // Check totalUnderlying via aToken balance
      const total = await aaveStrategy.totalUnderlying(vaultWithProdStrategy.target);
      expect(total).to.equal(DEPOSIT_AMOUNT);
      
      // Withdraw half
      const withdrawAmount = DEPOSIT_AMOUNT / 2n;
      await vaultWithProdStrategy.connect(user).withdraw(withdrawAmount, user.address, user.address);
      
      // Check updated totalUnderlying
      const totalAfter = await aaveStrategy.totalUnderlying(vaultWithProdStrategy.target);
      expect(totalAfter).to.equal(DEPOSIT_AMOUNT - withdrawAmount);
    });
    
    it("TestAaveStrategy should return correct totalUnderlying for testing", async function () {
      // Initially should be 0
      let total = await testStrategy.totalUnderlying(vault.target);
      expect(total).to.equal(0);
      
      // After deposit, should show the deposited amount
      await vault.connect(user).deposit(DEPOSIT_AMOUNT, user.address);
      total = await testStrategy.totalUnderlying(vault.target);
      expect(total).to.equal(DEPOSIT_AMOUNT);
    });
  });
});