import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  WstETHStrategy,
  MockWstETH,
  MockStETH,
  BolarityVault
} from "../typechain-types";

describe("WstETHStrategy - Multiple Deposits Issue", function () {
  let strategy: WstETHStrategy;
  let mockStETH: MockStETH;
  let mockWstETH: MockWstETH;
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

    // Deploy mock stETH
    const MockStETH = await ethers.getContractFactory("MockStETH");
    mockStETH = await MockStETH.deploy();
    await mockStETH.waitForDeployment();

    // Deploy mock wstETH
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
      "WstETH Vault",
      "vWST",
      strategy.target,
      owner.address, // router
      feeCollector.address,
      PERFORMANCE_FEE_BPS
    );
    await vault.waitForDeployment();

    // Mint stETH to user
    await mockStETH.mint(user.address, INITIAL_BALANCE);

    // Approve vault to spend stETH
    await mockStETH.connect(user).approve(vault.target, ethers.MaxUint256);
    
    // Authorize user to call vault directly for testing
    await vault.connect(owner).setAuthorizedCaller(user.address, true);
  });

  describe("Multiple Deposits Single Withdrawal Issue Test", function () {
    it("Should NOT reduce user's principal after multiple deposits and single withdrawal", async function () {
      console.log("\n=== Testing Multiple Deposits and Single Withdrawal ===\n");
      
      // Record initial balance
      const initialStETHBalance = await mockStETH.balanceOf(user.address);
      console.log("Initial stETH balance:", ethers.formatEther(initialStETHBalance));

      // First deposit
      console.log("\n1. First deposit: 100 stETH");
      await vault.connect(user).deposit(FIRST_DEPOSIT, user.address);
      let shares = await vault.balanceOf(user.address);
      console.log("   Shares after first deposit:", ethers.formatEther(shares));
      console.log("   Total assets in vault:", ethers.formatEther(await vault.totalAssets()));

      // Second deposit
      console.log("\n2. Second deposit: 100 stETH");
      await vault.connect(user).deposit(SECOND_DEPOSIT, user.address);
      shares = await vault.balanceOf(user.address);
      console.log("   Shares after second deposit:", ethers.formatEther(shares));
      console.log("   Total assets in vault:", ethers.formatEther(await vault.totalAssets()));

      // Third deposit
      console.log("\n3. Third deposit: 100 stETH");
      await vault.connect(user).deposit(THIRD_DEPOSIT, user.address);
      shares = await vault.balanceOf(user.address);
      console.log("   Shares after third deposit:", ethers.formatEther(shares));
      console.log("   Total assets in vault:", ethers.formatEther(await vault.totalAssets()));

      // Total deposited
      const totalDeposited = FIRST_DEPOSIT + SECOND_DEPOSIT + THIRD_DEPOSIT;
      console.log("\n4. Total deposited:", ethers.formatEther(totalDeposited));

      // Calculate expected assets for user (excluding fee collector shares if any)
      const userShares = await vault.balanceOf(user.address);
      const expectedAssets = await vault.convertToAssets(userShares);
      console.log("   User shares:", ethers.formatEther(userShares));
      console.log("   Expected assets for user shares:", ethers.formatEther(expectedAssets));

      // Withdraw all at once
      console.log("\n5. Withdrawing all shares at once");
      await vault.connect(user).redeem(userShares, user.address, user.address);

      // Check final balance
      const finalStETHBalance = await mockStETH.balanceOf(user.address);
      console.log("\n6. Final stETH balance:", ethers.formatEther(finalStETHBalance));
      
      // Calculate actual received
      const actualReceived = finalStETHBalance - (initialStETHBalance - totalDeposited);
      console.log("   Actual received from vault:", ethers.formatEther(actualReceived));
      console.log("   Total deposited:", ethers.formatEther(totalDeposited));
      
      // Check if user lost principal (should not happen)
      const loss = totalDeposited - actualReceived;
      if (loss > 0) {
        console.log("   ❌ LOSS DETECTED:", ethers.formatEther(loss), "stETH");
      } else {
        console.log("   ✅ No loss - User received back full principal");
      }

      // User should get back at least what they deposited (no loss on principal)
      expect(actualReceived).to.be.gte(totalDeposited, "User should not lose principal");
      
      // More precisely, they should get back exactly what they deposited (no gains/losses in wstETH)
      expect(actualReceived).to.be.closeTo(totalDeposited, ethers.parseEther("0.001")); // Allow 0.001 ETH tolerance for rounding
    });

    it("Should handle multiple deposits with stETH appreciation correctly", async function () {
      console.log("\n=== Testing Multiple Deposits with stETH Appreciation ===\n");
      
      const initialStETHBalance = await mockStETH.balanceOf(user.address);

      // First deposit
      console.log("1. First deposit: 100 stETH");
      await vault.connect(user).deposit(FIRST_DEPOSIT, user.address);

      // Simulate stETH appreciation (10% increase)
      console.log("2. Simulating 10% stETH appreciation");
      await mockWstETH.increaseStEthPerToken(1100); // from 1000 to 1100 (10% increase)

      // Second deposit after appreciation
      console.log("3. Second deposit: 100 stETH (after appreciation)");
      await vault.connect(user).deposit(SECOND_DEPOSIT, user.address);

      // Third deposit
      console.log("4. Third deposit: 100 stETH");
      await vault.connect(user).deposit(THIRD_DEPOSIT, user.address);

      const totalDeposited = FIRST_DEPOSIT + SECOND_DEPOSIT + THIRD_DEPOSIT;
      console.log("5. Total deposited:", ethers.formatEther(totalDeposited));

      // Get user's shares
      const userShares = await vault.balanceOf(user.address);
      console.log("   User shares:", ethers.formatEther(userShares));

      // Check total assets (should include appreciation)
      const totalAssets = await vault.totalAssets();
      console.log("   Total assets in vault:", ethers.formatEther(totalAssets));

      // Withdraw all
      console.log("6. Withdrawing all shares");
      await vault.connect(user).redeem(userShares, user.address, user.address);

      const finalStETHBalance = await mockStETH.balanceOf(user.address);
      const actualReceived = finalStETHBalance - (initialStETHBalance - totalDeposited);
      
      console.log("7. Results:");
      console.log("   Total deposited:", ethers.formatEther(totalDeposited));
      console.log("   Actual received:", ethers.formatEther(actualReceived));
      
      const profit = actualReceived - totalDeposited;
      if (profit > 0) {
        console.log("   ✅ Profit from appreciation:", ethers.formatEther(profit), "stETH");
      }

      // User should receive more than deposited due to appreciation
      expect(actualReceived).to.be.gt(totalDeposited, "User should profit from appreciation");
    });
  });
});