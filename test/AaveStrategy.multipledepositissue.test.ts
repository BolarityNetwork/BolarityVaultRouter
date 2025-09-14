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

describe("AaveStrategy - Multiple Deposits Issue", function () {
  let aaveStrategy: AaveStrategy;
  let testStrategy: TestAaveStrategy;
  let mockToken: MockERC20;
  let mockAavePool: MockAavePool;
  let mockAToken: MockAToken;
  let vault: BolarityVault;
  
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("10000");
  const FIRST_DEPOSIT = ethers.parseEther("100");
  const SECOND_DEPOSIT = ethers.parseEther("100");
  const THIRD_DEPOSIT = ethers.parseEther("100");
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

    // Deploy TestAaveStrategy (with totalUnderlying support)
    const TestAaveStrategy = await ethers.getContractFactory("TestAaveStrategy");
    testStrategy = await TestAaveStrategy.deploy(mockAavePool.target, poolDataProviderAddress);
    await testStrategy.waitForDeployment();

    // Deploy BolarityVault with TestAaveStrategy
    const BolarityVault = await ethers.getContractFactory("BolarityVault");
    vault = await BolarityVault.deploy(
      mockToken.target,
      "Test Vault",
      "tVAULT",
      testStrategy.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Mint tokens to user
    await mockToken.mint(user.address, INITIAL_BALANCE);
    
    // Mint tokens to owner for simulating gains
    await mockToken.mint(owner.address, ethers.parseEther("100000"));

    // Approve vault
    await mockToken.connect(user).approve(vault.target, ethers.MaxUint256);
    
    // Approve aToken for owner to simulate gains
    await mockToken.connect(owner).approve(mockAToken.target, ethers.MaxUint256);
  });

  describe("Multiple Deposits Single Withdrawal Issue Test", function () {
    it("Should NOT reduce user's principal after multiple deposits and single withdrawal", async function () {
      console.log("\n=== Testing AAVE Multiple Deposits and Single Withdrawal ===\n");
      
      // Record initial balance
      const initialBalance = await mockToken.balanceOf(user.address);
      console.log("Initial token balance:", ethers.formatEther(initialBalance));

      // First deposit
      console.log("\n1. First deposit: 100 tokens");
      await vault.connect(user).deposit(FIRST_DEPOSIT, user.address);
      let shares = await vault.balanceOf(user.address);
      console.log("   Shares after first deposit:", ethers.formatEther(shares));
      console.log("   Total assets in vault:", ethers.formatEther(await vault.totalAssets()));

      // Second deposit
      console.log("\n2. Second deposit: 100 tokens");
      await vault.connect(user).deposit(SECOND_DEPOSIT, user.address);
      shares = await vault.balanceOf(user.address);
      console.log("   Shares after second deposit:", ethers.formatEther(shares));
      console.log("   Total assets in vault:", ethers.formatEther(await vault.totalAssets()));

      // Third deposit
      console.log("\n3. Third deposit: 100 tokens");
      await vault.connect(user).deposit(THIRD_DEPOSIT, user.address);
      shares = await vault.balanceOf(user.address);
      console.log("   Shares after third deposit:", ethers.formatEther(shares));
      console.log("   Total assets in vault:", ethers.formatEther(await vault.totalAssets()));

      // Total deposited
      const totalDeposited = FIRST_DEPOSIT + SECOND_DEPOSIT + THIRD_DEPOSIT;
      console.log("\n4. Total deposited:", ethers.formatEther(totalDeposited));

      // Check aToken balance in the contract
      const aTokenBalance = await mockToken.balanceOf(mockAToken.target);
      console.log("   Underlying in aToken contract:", ethers.formatEther(aTokenBalance));

      // Calculate expected assets for user
      const userShares = await vault.balanceOf(user.address);
      const expectedAssets = await vault.convertToAssets(userShares);
      console.log("   User shares:", ethers.formatEther(userShares));
      console.log("   Expected assets for user shares:", ethers.formatEther(expectedAssets));

      // Withdraw all at once
      console.log("\n5. Withdrawing all shares at once");
      await vault.connect(user).redeem(userShares, user.address, user.address);

      // Check final balance
      const finalBalance = await mockToken.balanceOf(user.address);
      console.log("\n6. Final token balance:", ethers.formatEther(finalBalance));
      
      // Calculate actual received
      const actualReceived = finalBalance - (initialBalance - totalDeposited);
      console.log("   Actual received from vault:", ethers.formatEther(actualReceived));
      console.log("   Total deposited:", ethers.formatEther(totalDeposited));
      
      // Check if user lost principal
      const loss = totalDeposited - actualReceived;
      if (loss > 0) {
        console.log("   ❌ LOSS DETECTED:", ethers.formatEther(loss), "tokens");
      } else {
        console.log("   ✅ No loss - User received back full principal");
      }

      // User should get back at least what they deposited
      expect(actualReceived).to.be.gte(totalDeposited, "User should not lose principal");
      
      // More precisely, they should get back exactly what they deposited (no gains/losses)
      expect(actualReceived).to.be.closeTo(totalDeposited, ethers.parseEther("0.001"));
    });

    it("Should handle multiple deposits with AAVE yields correctly", async function () {
      console.log("\n=== Testing AAVE Multiple Deposits with Yields ===\n");
      
      const initialBalance = await mockToken.balanceOf(user.address);

      // First deposit
      console.log("1. First deposit: 100 tokens");
      await vault.connect(user).deposit(FIRST_DEPOSIT, user.address);
      const firstDepositShares = await vault.balanceOf(user.address);
      console.log("   Shares from first deposit:", ethers.formatEther(firstDepositShares));

      // Simulate AAVE yield (10% gain)
      console.log("\n2. Simulating 10% AAVE yield");
      const gainAmount = ethers.parseEther("10"); // 10% of 100
      await mockAToken.connect(owner).simulateGain(gainAmount);
      console.log("   Total assets after gain:", ethers.formatEther(await vault.totalAssets()));

      // Second deposit after yield
      console.log("\n3. Second deposit: 100 tokens (after yield)");
      await vault.connect(user).deposit(SECOND_DEPOSIT, user.address);
      const secondDepositShares = await vault.balanceOf(user.address) - firstDepositShares;
      console.log("   Shares from second deposit:", ethers.formatEther(secondDepositShares));
      console.log("   Total user shares:", ethers.formatEther(await vault.balanceOf(user.address)));

      // Third deposit
      console.log("\n4. Third deposit: 100 tokens");
      await vault.connect(user).deposit(THIRD_DEPOSIT, user.address);
      const totalShares = await vault.balanceOf(user.address);
      console.log("   Total user shares after all deposits:", ethers.formatEther(totalShares));

      const totalDeposited = FIRST_DEPOSIT + SECOND_DEPOSIT + THIRD_DEPOSIT;
      console.log("\n5. Total deposited:", ethers.formatEther(totalDeposited));
      console.log("   Total assets in vault:", ethers.formatEther(await vault.totalAssets()));

      // Withdraw all
      console.log("\n6. Withdrawing all shares");
      await vault.connect(user).redeem(totalShares, user.address, user.address);

      const finalBalance = await mockToken.balanceOf(user.address);
      const actualReceived = finalBalance - (initialBalance - totalDeposited);
      
      console.log("\n7. Results:");
      console.log("   Total deposited:", ethers.formatEther(totalDeposited));
      console.log("   Actual received:", ethers.formatEther(actualReceived));
      
      const profit = actualReceived - totalDeposited;
      if (profit > 0) {
        console.log("   ✅ Profit from AAVE yields:", ethers.formatEther(profit), "tokens");
      }

      // User should receive more than deposited due to yields
      expect(actualReceived).to.be.gt(totalDeposited, "User should profit from yields");
    });

    it("Should handle multiple deposits with AAVE losses correctly", async function () {
      console.log("\n=== Testing AAVE Multiple Deposits with Losses ===\n");
      
      const initialBalance = await mockToken.balanceOf(user.address);

      // First deposit
      console.log("1. First deposit: 100 tokens");
      await vault.connect(user).deposit(FIRST_DEPOSIT, user.address);

      // Simulate AAVE loss (10% loss)
      console.log("2. Simulating 10% AAVE loss");
      const lossAmount = ethers.parseEther("10"); // 10% of 100
      await mockAToken.connect(owner).simulateLoss(lossAmount);

      // Second deposit after loss
      console.log("3. Second deposit: 100 tokens (after loss)");
      await vault.connect(user).deposit(SECOND_DEPOSIT, user.address);

      // Third deposit
      console.log("4. Third deposit: 100 tokens");
      await vault.connect(user).deposit(THIRD_DEPOSIT, user.address);

      const totalDeposited = FIRST_DEPOSIT + SECOND_DEPOSIT + THIRD_DEPOSIT;
      const totalShares = await vault.balanceOf(user.address);
      
      console.log("5. Total deposited:", ethers.formatEther(totalDeposited));
      console.log("   Total shares:", ethers.formatEther(totalShares));
      console.log("   Total assets in vault:", ethers.formatEther(await vault.totalAssets()));

      // Withdraw all
      console.log("6. Withdrawing all shares");
      await vault.connect(user).redeem(totalShares, user.address, user.address);

      const finalBalance = await mockToken.balanceOf(user.address);
      const actualReceived = finalBalance - (initialBalance - totalDeposited);
      
      console.log("7. Results:");
      console.log("   Total deposited:", ethers.formatEther(totalDeposited));
      console.log("   Actual received:", ethers.formatEther(actualReceived));
      
      const loss = totalDeposited - actualReceived;
      console.log("   Expected loss from first deposit (10% of 100):", ethers.formatEther(lossAmount));
      console.log("   Actual total loss:", ethers.formatEther(loss));

      // User should have a loss, but it should be proportional only to the first deposit
      expect(actualReceived).to.be.lt(totalDeposited, "User should have loss from AAVE");
      expect(loss).to.be.closeTo(lossAmount, ethers.parseEther("0.01"), "Loss should be close to 10 tokens");
    });
  });
});