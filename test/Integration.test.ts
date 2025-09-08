import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  BolarityRouter, 
  Registry, 
  VaultFactory, 
  BolarityVault,
  MockERC20,
  MockStrategy
} from "../typechain-types";

describe("Vault System Integration", function () {
  let router: BolarityRouter;
  let registry: Registry;
  let factory: VaultFactory;
  let vaultAAVE: BolarityVault;
  let vaultCompound: BolarityVault;
  let vaultUniswap: BolarityVault;
  let usdc: MockERC20;
  let dai: MockERC20;
  let mockAavePool: any;
  let strategyAAVE: MockStrategy;
  let strategyCompound: MockStrategy;
  let strategyUniswap: MockStrategy;
  let strategyDAI: MockStrategy;
  
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let treasury: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("100000");
  const ALICE_DEPOSIT = ethers.parseEther("10000");
  const BOB_DEPOSIT = ethers.parseEther("5000");
  const CHARLIE_DEPOSIT = ethers.parseEther("15000");
  
  const MARKET_AAVE = ethers.encodeBytes32String("AAVE");
  const MARKET_COMPOUND = ethers.encodeBytes32String("COMPOUND");
  const MARKET_UNISWAP = ethers.encodeBytes32String("UNISWAP");
  
  const PERFORMANCE_FEE_BPS = 1000; // 10%

  async function setupProtocol() {
    [owner, alice, bob, charlie, feeCollector, treasury] = await ethers.getSigners();

    // Deploy core infrastructure
    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy(await registry.getAddress());
    await factory.waitForDeployment();

    await registry.transferOwnership(await factory.getAddress());

    const BolarityRouter = await ethers.getContractFactory("BolarityRouter");
    router = await BolarityRouter.deploy(
      await registry.getAddress(),
      await factory.getAddress()
    );
    await router.waitForDeployment();
    
    // Set router on factory
    await factory.setRouter(await router.getAddress());

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();
    
    dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
    await dai.waitForDeployment();

    // Deploy mock Aave pool
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAavePool = await MockAavePool.deploy();
    await mockAavePool.waitForDeployment();

    // Deploy strategies
    const MockStrategy = await ethers.getContractFactory("MockStrategy");
    strategyAAVE = await MockStrategy.deploy(mockAavePool.target);
    await strategyAAVE.waitForDeployment();
    
    strategyCompound = await MockStrategy.deploy(mockAavePool.target);
    await strategyCompound.waitForDeployment();
    
    strategyUniswap = await MockStrategy.deploy(mockAavePool.target);
    await strategyUniswap.waitForDeployment();
    
    strategyDAI = await MockStrategy.deploy(mockAavePool.target);
    await strategyDAI.waitForDeployment();

    // Create vaults for USDC across different markets
    await factory.createVault(
      usdc.target,
      MARKET_AAVE,
      strategyAAVE.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS,
      "Bolarity USDC AAVE Vault",
      "bUSDC-AAVE"
    );

    await factory.createVault(
      usdc.target,
      MARKET_COMPOUND,
      strategyCompound.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS,
      "Bolarity USDC Compound Vault",
      "bUSDC-COMP"
    );

    await factory.createVault(
      usdc.target,
      MARKET_UNISWAP,
      strategyUniswap.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS,
      "Bolarity USDC Uniswap Vault",
      "bUSDC-UNI"
    );

    // Create a vault for DAI
    await factory.createVault(
      dai.target,
      MARKET_AAVE,
      strategyDAI.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS,
      "Bolarity DAI AAVE Vault",
      "bDAI-AAVE"
    );

    // Get vault instances
    vaultAAVE = await ethers.getContractAt(
      "BolarityVault",
      await registry.getVault(usdc.target, MARKET_AAVE)
    );
    vaultCompound = await ethers.getContractAt(
      "BolarityVault",
      await registry.getVault(usdc.target, MARKET_COMPOUND)
    );
    vaultUniswap = await ethers.getContractAt(
      "BolarityVault",
      await registry.getVault(usdc.target, MARKET_UNISWAP)
    );
    
    // Get DAI vault instance
    const vaultDAI = await ethers.getContractAt(
      "BolarityVault",
      await registry.getVault(dai.target, MARKET_AAVE)
    );
    
    // Set router on all vaults
    await vaultAAVE.setRouter(await router.getAddress());
    await vaultCompound.setRouter(await router.getAddress());
    await vaultUniswap.setRouter(await router.getAddress());
    await vaultDAI.setRouter(await router.getAddress());

    // Set preferred market for USDC
    await factory.recoverRegistryOwnership();
    await registry.setPreferredMarket(usdc.target, MARKET_AAVE);
    await registry.transferOwnership(await factory.getAddress());

    // Fund users
    await usdc.mint(alice.address, INITIAL_BALANCE);
    await usdc.mint(bob.address, INITIAL_BALANCE);
    await usdc.mint(charlie.address, INITIAL_BALANCE);
    await dai.mint(alice.address, INITIAL_BALANCE);

    // Approve router
    await usdc.connect(alice).approve(router.target, ethers.MaxUint256);
    await usdc.connect(bob).approve(router.target, ethers.MaxUint256);
    await usdc.connect(charlie).approve(router.target, ethers.MaxUint256);
    await dai.connect(alice).approve(router.target, ethers.MaxUint256);
  }

  describe("Complete User Journey", function () {
    beforeEach(async function () {
      await setupProtocol();
    });

    it("Should handle multiple users depositing to different vaults", async function () {
      // Alice deposits to AAVE vault
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ALICE_DEPOSIT,
        alice.address,
        "0x"
      );

      // Bob deposits to Compound vault
      await router.connect(bob).deposit(
        usdc.target,
        MARKET_COMPOUND,
        BOB_DEPOSIT,
        bob.address,
        "0x"
      );

      // Charlie deposits to Uniswap vault
      await router.connect(charlie).deposit(
        usdc.target,
        MARKET_UNISWAP,
        CHARLIE_DEPOSIT,
        charlie.address,
        "0x"
      );

      // Verify balances
      expect(await vaultAAVE.balanceOf(alice.address)).to.be.greaterThan(0);
      expect(await vaultCompound.balanceOf(bob.address)).to.be.greaterThan(0);
      expect(await vaultUniswap.balanceOf(charlie.address)).to.be.greaterThan(0);

      // Verify total assets
      expect(await vaultAAVE.totalAssets()).to.equal(ALICE_DEPOSIT);
      expect(await vaultCompound.totalAssets()).to.equal(BOB_DEPOSIT);
      expect(await vaultUniswap.totalAssets()).to.equal(CHARLIE_DEPOSIT);
    });

    it("Should handle multiple deposits and withdrawals", async function () {
      // Initial deposits
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ALICE_DEPOSIT,
        alice.address,
        "0x"
      );

      await router.connect(bob).deposit(
        usdc.target,
        MARKET_AAVE,
        BOB_DEPOSIT,
        bob.address,
        "0x"
      );

      // Partial withdrawal by Alice
      const aliceWithdrawAmount = ethers.parseEther("5000");
      await vaultAAVE.connect(alice).approve(router.target, ethers.MaxUint256);
      await router.connect(alice).withdraw(
        usdc.target,
        MARKET_AAVE,
        aliceWithdrawAmount,
        alice.address,
        alice.address,
        "0x"
      );

      // Charlie deposits
      await router.connect(charlie).deposit(
        usdc.target,
        MARKET_AAVE,
        CHARLIE_DEPOSIT,
        charlie.address,
        "0x"
      );

      // Verify total assets
      const expectedTotal = ALICE_DEPOSIT - aliceWithdrawAmount + BOB_DEPOSIT + CHARLIE_DEPOSIT;
      expect(await vaultAAVE.totalAssets()).to.equal(expectedTotal);
    });

    it("Should properly distribute performance fees", async function () {
      // Users deposit
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ALICE_DEPOSIT,
        alice.address,
        "0x"
      );

      const aliceShares = await vaultAAVE.balanceOf(alice.address);

      // Simulate profit by adding tokens to strategy
      const profit = ethers.parseEther("1000");
      await usdc.mint(vaultAAVE.target, profit);

      // Bob deposits (this should trigger fee crystallization)
      await router.connect(bob).deposit(
        usdc.target,
        MARKET_AAVE,
        BOB_DEPOSIT,
        bob.address,
        "0x"
      );

      // Check fee collector received shares
      const feeCollectorShares = await vaultAAVE.balanceOf(feeCollector.address);
      expect(feeCollectorShares).to.be.greaterThan(0);

      // Fee collector withdraws
      await vaultAAVE.connect(feeCollector).redeem(
        feeCollectorShares,
        feeCollector.address,
        feeCollector.address
      );

      const feeCollectorBalance = await usdc.balanceOf(feeCollector.address);
      expect(feeCollectorBalance).to.be.greaterThan(0);
      
      // Should be approximately 10% of profit
      const expectedFee = profit * BigInt(PERFORMANCE_FEE_BPS) / 10000n;
      expect(feeCollectorBalance).to.be.closeTo(expectedFee, ethers.parseEther("10"));
    });

    it("Should handle multi-vault operations", async function () {
      // Alice deposits to multiple vaults in one transaction
      const deposits = [
        {
          asset: usdc.target,
          market: MARKET_AAVE,
          amount: ethers.parseEther("3000")
        },
        {
          asset: usdc.target,
          market: MARKET_COMPOUND,
          amount: ethers.parseEther("2000")
        },
        {
          asset: usdc.target,
          market: MARKET_UNISWAP,
          amount: ethers.parseEther("5000")
        }
      ];

      // Extract arrays for the function call
      const assets = deposits.map(d => d.asset);
      const markets = deposits.map(d => d.market);
      const amounts = deposits.map(d => d.amount);
      
      await router.connect(alice).depositMultiple(assets, markets, amounts, alice.address);

      // Verify all deposits
      expect(await vaultAAVE.balanceOf(alice.address)).to.be.greaterThan(0);
      expect(await vaultCompound.balanceOf(alice.address)).to.be.greaterThan(0);
      expect(await vaultUniswap.balanceOf(alice.address)).to.be.greaterThan(0);

      // Alice withdraws from multiple vaults
      const withdrawals = [
        {
          asset: usdc.target,
          market: MARKET_AAVE,
          amount: ethers.parseEther("1000")
        },
        {
          asset: usdc.target,
          market: MARKET_COMPOUND,
          amount: ethers.parseEther("500")
        }
      ];

      const balanceBefore = await usdc.balanceOf(alice.address);
      
      // Approve router to spend vault shares
      await vaultAAVE.connect(alice).approve(router.target, ethers.MaxUint256);
      await vaultCompound.connect(alice).approve(router.target, ethers.MaxUint256);
      
      // Extract arrays for the function call
      const wAssets = withdrawals.map(w => w.asset);
      const wMarkets = withdrawals.map(w => w.market);
      const wAmounts = withdrawals.map(w => w.amount);
      
      await router.connect(alice).withdrawMultiple(wAssets, wMarkets, wAmounts, alice.address, alice.address);
      const balanceAfter = await usdc.balanceOf(alice.address);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1500"));
    });

    it("Should handle strategy migration correctly", async function () {
      // Users deposit
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ALICE_DEPOSIT,
        alice.address,
        "0x"
      );

      await router.connect(bob).deposit(
        usdc.target,
        MARKET_AAVE,
        BOB_DEPOSIT,
        bob.address,
        "0x"
      );

      const totalAssetsBefore = await vaultAAVE.totalAssets();

      // Deploy new strategy
      const MockStrategy = await ethers.getContractFactory("MockStrategy");
      const newStrategy = await MockStrategy.deploy(mockAavePool.target);
      await newStrategy.waitForDeployment();

      // Migrate strategy
      await vaultAAVE.setStrategy(newStrategy.target);

      // Verify funds were transferred to the pool during deposits
      expect(await usdc.balanceOf(vaultAAVE.target)).to.equal(0);
      expect(await usdc.balanceOf(mockAavePool.target)).to.equal(totalAssetsBefore);
      expect(await vaultAAVE.totalAssets()).to.equal(totalAssetsBefore);

      // Users should still be able to withdraw
      await vaultAAVE.connect(alice).approve(router.target, ethers.MaxUint256);
      await router.connect(alice).withdraw(
        usdc.target,
        MARKET_AAVE,
        ethers.parseEther("1000"),
        alice.address,
        alice.address,
        "0x"
      );

      expect(await usdc.balanceOf(alice.address)).to.be.greaterThan(INITIAL_BALANCE - ALICE_DEPOSIT);
    });

    it("Should handle emergency scenarios", async function () {
      // Users deposit
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ALICE_DEPOSIT,
        alice.address,
        "0x"
      );

      await router.connect(bob).deposit(
        usdc.target,
        MARKET_COMPOUND,
        BOB_DEPOSIT,
        bob.address,
        "0x"
      );

      // Pause a vault
      await vaultAAVE.pause();

      // Alice cannot deposit or withdraw from paused vault
      await expect(
        router.connect(alice).deposit(
          usdc.target,
          MARKET_AAVE,
          ethers.parseEther("1000"),
          alice.address,
          "0x"
        )
      ).to.be.reverted;

      // Unpause
      await vaultAAVE.unpause();

      // Now Alice can withdraw
      await vaultAAVE.connect(alice).approve(router.target, ethers.MaxUint256);
      await router.connect(alice).withdraw(
        usdc.target,
        MARKET_AAVE,
        ethers.parseEther("1000"),
        alice.address,
        alice.address,
        "0x"
      );

      // Simulate stuck funds in router by transferring some shares
      // First, Alice gets some shares
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ethers.parseEther("2000"),
        alice.address,
        "0x"
      );
      
      // Transfer shares to router to simulate stuck funds
      const aliceShares = await vaultAAVE.balanceOf(alice.address);
      await vaultAAVE.connect(alice).transfer(router.target, aliceShares);

      // Emergency withdraw by owner through router
      const vaults = [
        { asset: usdc.target, market: MARKET_AAVE },
        { asset: usdc.target, market: MARKET_COMPOUND }
      ];

      // Emergency withdraw for each vault individually
      const treasuryBalanceBefore = await usdc.balanceOf(treasury.address);
      for (const vault of vaults) {
        const vaultAddr = await registry.getVault(vault.asset, vault.market);
        if (vaultAddr !== ethers.ZeroAddress) {
          const vaultContract = await ethers.getContractAt("BolarityVault", vaultAddr);
          const routerShares = await vaultContract.balanceOf(router.target);
          
          if (routerShares > 0n) {
            await router.emergencyWithdrawAll(vault.asset, vault.market, treasury.address);
          }
        }
      }

      const treasuryBalanceAfter = await usdc.balanceOf(treasury.address);
      expect(treasuryBalanceAfter).to.be.greaterThan(treasuryBalanceBefore);
    });

    it("Should correctly calculate share prices with profits", async function () {
      // Initial deposit
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ALICE_DEPOSIT,
        alice.address,
        "0x"
      );

      const aliceSharesInitial = await vaultAAVE.balanceOf(alice.address);
      expect(aliceSharesInitial).to.equal(ALICE_DEPOSIT); // 1:1 initially

      // Simulate 20% profit
      const profit = ALICE_DEPOSIT * 20n / 100n;
      await usdc.mint(vaultAAVE.target, profit);

      // Bob deposits after profit
      await router.connect(bob).deposit(
        usdc.target,
        MARKET_AAVE,
        BOB_DEPOSIT,
        bob.address,
        "0x"
      );

      const bobShares = await vaultAAVE.balanceOf(bob.address);
      
      // Bob should get fewer shares due to higher share price
      expect(bobShares).to.be.lessThan(BOB_DEPOSIT);

      // Calculate expected shares for Bob
      // Share price after profit and fees
      const totalAssetsAfterProfit = ALICE_DEPOSIT + profit;
      const performanceFee = profit * BigInt(PERFORMANCE_FEE_BPS) / 10000n;
      const feeShares = await vaultAAVE.balanceOf(feeCollector.address);
      
      // Bob's shares should reflect the new share price
      const expectedBobShares = BOB_DEPOSIT * (aliceSharesInitial + feeShares) / totalAssetsAfterProfit;
      expect(bobShares).to.be.closeTo(expectedBobShares, ethers.parseEther("10"));
    });

    it("Should handle cross-asset operations", async function () {
      // Alice deposits both USDC and DAI
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ethers.parseEther("5000"),
        alice.address,
        "0x"
      );

      await router.connect(alice).deposit(
        dai.target,
        MARKET_AAVE,
        ethers.parseEther("3000"),
        alice.address,
        "0x"
      );

      // Check both vaults
      const usdcVault = await ethers.getContractAt(
        "BolarityVault",
        await registry.getVault(usdc.target, MARKET_AAVE)
      );
      const daiVault = await ethers.getContractAt(
        "BolarityVault",
        await registry.getVault(dai.target, MARKET_AAVE)
      );

      expect(await usdcVault.balanceOf(alice.address)).to.be.greaterThan(0);
      expect(await daiVault.balanceOf(alice.address)).to.be.greaterThan(0);

      // Multi-asset withdrawal
      const withdrawals = [
        {
          asset: usdc.target,
          market: MARKET_AAVE,
          amount: ethers.parseEther("1000")
        },
        {
          asset: dai.target,
          market: MARKET_AAVE,
          amount: ethers.parseEther("500")
        }
      ];

      // Approve router to spend vault shares
      await usdcVault.connect(alice).approve(router.target, ethers.MaxUint256);
      await daiVault.connect(alice).approve(router.target, ethers.MaxUint256);

      // Extract arrays for withdrawMultiple
      const wAssets2 = withdrawals.map(w => w.asset);
      const wMarkets2 = withdrawals.map(w => w.market);
      const wAmounts2 = withdrawals.map(w => w.amount);
      
      await router.connect(alice).withdrawMultiple(wAssets2, wMarkets2, wAmounts2, alice.address, alice.address);

      expect(await usdc.balanceOf(alice.address)).to.be.greaterThan(INITIAL_BALANCE - ethers.parseEther("5000"));
      expect(await dai.balanceOf(alice.address)).to.be.greaterThan(INITIAL_BALANCE - ethers.parseEther("3000"));
    });
  });

  describe("Edge Cases and Error Handling", function () {
    beforeEach(async function () {
      await setupProtocol();
    });

    it("Should handle zero amount deposits gracefully", async function () {
      await expect(
        router.connect(alice).deposit(
          usdc.target,
          MARKET_AAVE,
          0,
          alice.address,
          "0x"
        )
      ).to.be.reverted;
    });

    it("Should handle insufficient balance withdrawals", async function () {
      await router.connect(alice).deposit(
        usdc.target,
        MARKET_AAVE,
        ethers.parseEther("1000"),
        alice.address,
        "0x"
      );

      // Get vault and approve router
      const vault = await ethers.getContractAt(
        "BolarityVault",
        await registry.getVault(usdc.target, MARKET_AAVE)
      );
      await vault.connect(alice).approve(router.target, ethers.MaxUint256);

      await expect(
        router.connect(alice).withdraw(
          usdc.target,
          MARKET_AAVE,
          ethers.parseEther("2000"),
          alice.address,
          alice.address,
          "0x"
        )
      ).to.be.reverted;
    });

    it("Should handle vault not found errors", async function () {
      const INVALID_MARKET = ethers.encodeBytes32String("INVALID");
      
      await expect(
        router.connect(alice).deposit(
          usdc.target,
          INVALID_MARKET,
          ethers.parseEther("1000"),
          alice.address,
          "0x"
        )
      ).to.be.revertedWith("BolarityRouter: Vault not found");
    });

    it("Should prevent duplicate vault creation", async function () {
      await expect(
        factory.createVault(
          usdc.target,
          MARKET_AAVE,
          strategyAAVE.target,
          feeCollector.address,
          PERFORMANCE_FEE_BPS,
          "Duplicate Vault",
          "DUP"
        )
      ).to.be.reverted;
    });

    it("Should handle maximum fee scenarios", async function () {
      // Create vault with maximum fee (30%)
      const maxFeeBps = 3000;
      const newToken = await ethers.deployContract("MockERC20", ["Test", "TEST", 18]);
      const newStrategy = await ethers.deployContract("MockStrategy", [mockAavePool.target]);

      await factory.createVault(
        newToken.target,
        MARKET_AAVE,
        newStrategy.target,
        feeCollector.address,
        maxFeeBps,
        "High Fee Vault",
        "HFV"
      );

      const highFeeVault = await ethers.getContractAt(
        "BolarityVault",
        await registry.getVault(newToken.target, MARKET_AAVE)
      );

      expect(await highFeeVault.perfFeeBps()).to.equal(maxFeeBps);

      // Try to set fee above maximum
      await expect(
        highFeeVault.setPerfFeeBps(3001)
      ).to.be.revertedWith("BolarityVault: Fee too high");
    });
  });

  describe("Gas Optimization Tests", function () {
    beforeEach(async function () {
      await setupProtocol();
    });

    it("Should efficiently handle batch operations", async function () {
      // Prepare large batch of deposits
      const deposits = [];
      const markets = [MARKET_AAVE, MARKET_COMPOUND, MARKET_UNISWAP];
      
      for (let i = 0; i < 3; i++) {
        deposits.push({
          asset: usdc.target,
          market: markets[i],
          amount: ethers.parseEther((1000 * (i + 1)).toString())
        });
      }

      // Execute batch deposit
      // Extract arrays for depositMultiple
      const batchAssets = deposits.map(d => d.asset);
      const batchMarkets = deposits.map(d => d.market);
      const batchAmounts = deposits.map(d => d.amount);
      
      const tx = await router.connect(alice).depositMultiple(batchAssets, batchMarkets, batchAmounts, alice.address);
      const receipt = await tx.wait();

      // Check gas usage is reasonable for 3 deposits
      expect(receipt?.gasUsed).to.be.lessThan(1000000n);

      // Verify all deposits succeeded
      for (let i = 0; i < markets.length; i++) {
        const vault = await ethers.getContractAt(
          "BolarityVault",
          await registry.getVault(usdc.target, markets[i])
        );
        expect(await vault.balanceOf(alice.address)).to.be.greaterThan(0);
      }
    });
  });
});