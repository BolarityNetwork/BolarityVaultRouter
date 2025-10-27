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

describe("BolarityRouter", function () {
  let router: BolarityRouter;
  let registry: Registry;
  let factory: VaultFactory;
  let vault1: BolarityVault;
  let vault2: BolarityVault;
  let token1: MockERC20;
  let token2: MockERC20;
  let mockAavePool: any;
  let strategy1: MockStrategy;
  let strategy2: MockStrategy;
  
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  let treasury: SignerWithAddress;

  const INITIAL_BALANCE = ethers.parseEther("10000");
  const DEPOSIT_AMOUNT = ethers.parseEther("1000");
  const MARKET_AAVE = ethers.encodeBytes32String("AAVE");
  const MARKET_COMPOUND = ethers.encodeBytes32String("COMPOUND");
  const PERFORMANCE_FEE_BPS = 1000; // 10%

  beforeEach(async function () {
    [owner, user, feeCollector, treasury] = await ethers.getSigners();

    // Deploy Registry
    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    // Deploy BolarityRouter first (needs to be deployed before factory)
    const BolarityRouter = await ethers.getContractFactory("BolarityRouter");
    router = await BolarityRouter.deploy(
      await registry.getAddress()
    );
    await router.waitForDeployment();

    // Deploy VaultFactory with router
    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy(
      await registry.getAddress(),
      await router.getAddress()
    );
    await factory.waitForDeployment();

    // Transfer registry ownership to factory
    await registry.transferOwnership(await factory.getAddress());

    // Deploy Mock Tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    token1 = await MockERC20.deploy("Mock Token 1", "MOCK1", 18);
    await token1.waitForDeployment();
    
    token2 = await MockERC20.deploy("Mock Token 2", "MOCK2", 18);
    await token2.waitForDeployment();

    // Deploy Mock Aave Pool (simulates Aave pool)
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAavePool = await MockAavePool.deploy();
    await mockAavePool.waitForDeployment();

    // Deploy Mock Strategies
    const MockStrategy = await ethers.getContractFactory("MockStrategy");
    strategy1 = await MockStrategy.deploy();
    await strategy1.waitForDeployment();
    
    strategy2 = await MockStrategy.deploy();
    await strategy2.waitForDeployment();

    // Create vaults through factory
    await factory.createVault(
      token1.target,
      MARKET_AAVE,
      strategy1.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS,
      "Bolarity Token1 AAVE Vault",
      "bTOKEN1-AAVE"
    );

    await factory.createVault(
      token2.target,
      MARKET_COMPOUND,
      strategy2.target,
      feeCollector.address,
      PERFORMANCE_FEE_BPS,
      "Bolarity Token2 Compound Vault",
      "bTOKEN2-COMP"
    );

    // Get vault addresses
    const vault1Address = await registry.getVault(token1.target, MARKET_AAVE);
    const vault2Address = await registry.getVault(token2.target, MARKET_COMPOUND);
    
    vault1 = await ethers.getContractAt("BolarityVault", vault1Address);
    vault2 = await ethers.getContractAt("BolarityVault", vault2Address);
    
    // Note: Vaults already have router set from factory creation, no need to set again

    // Mint tokens to user
    await token1.mint(user.address, INITIAL_BALANCE);
    await token2.mint(user.address, INITIAL_BALANCE);

    // Approve router to spend tokens
    await token1.connect(user).approve(router.target, ethers.MaxUint256);
    await token2.connect(user).approve(router.target, ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the correct registry", async function () {
      expect(await router.registry()).to.equal(await registry.getAddress());
    });

    it("Should set the correct owner", async function () {
      expect(await router.owner()).to.equal(owner.address);
    });

    it("Should revert with zero registry address", async function () {
      const BolarityRouter = await ethers.getContractFactory("BolarityRouter");
      await expect(
        BolarityRouter.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("BolarityRouter: Invalid registry");
    });
  });

  describe("deposit", function () {
    it("Should deposit to specific vault", async function () {
      const sharesBefore = await vault1.balanceOf(user.address);
      
      await router.connect(user).deposit(
        token1.target,
        MARKET_AAVE,
        DEPOSIT_AMOUNT,
        user.address,
        "0x" // empty data
      );

      const sharesAfter = await vault1.balanceOf(user.address);
      expect(sharesAfter - sharesBefore).to.be.greaterThan(0);
    });

    it("Should transfer tokens from user to vault", async function () {
      const userBalanceBefore = await token1.balanceOf(user.address);
      
      await router.connect(user).deposit(
        token1.target,
        MARKET_AAVE,
        DEPOSIT_AMOUNT,
        user.address,
        "0x"
      );

      const userBalanceAfter = await token1.balanceOf(user.address);
      expect(userBalanceBefore - userBalanceAfter).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should emit Deposited event", async function () {
      await expect(
        router.connect(user).deposit(
          token1.target,
          MARKET_AAVE,
          DEPOSIT_AMOUNT,
          user.address,
          "0x"
        )
      ).to.emit(router, "Deposited");
    });

    it("Should revert if vault not found", async function () {
      const MARKET_UNISWAP = ethers.encodeBytes32String("UNISWAP");
      
      await expect(
        router.connect(user).deposit(
          token1.target,
          MARKET_UNISWAP,
          DEPOSIT_AMOUNT,
          user.address,
          "0x"
        )
      ).to.be.revertedWith("BolarityRouter: Vault not found");
    });

    it("Should handle deposits to different receiver", async function () {
      await router.connect(user).deposit(
        token1.target,
        MARKET_AAVE,
        DEPOSIT_AMOUNT,
        treasury.address,
        "0x"
      );

      expect(await vault1.balanceOf(treasury.address)).to.be.greaterThan(0);
      expect(await vault1.balanceOf(user.address)).to.equal(0);
    });
  });

  describe("withdraw", function () {
    beforeEach(async function () {
      // Deposit first
      await router.connect(user).deposit(
        token1.target,
        MARKET_AAVE,
        DEPOSIT_AMOUNT,
        user.address,
        "0x"
      );
      
      // Approve router to withdraw vault shares on behalf of user
      await vault1.connect(user).approve(router.target, ethers.MaxUint256);
    });

    it("Should withdraw from specific vault", async function () {
      const sharesBefore = await vault1.balanceOf(user.address);
      const tokenBalanceBefore = await token1.balanceOf(user.address);
      
      const withdrawAmount = ethers.parseEther("500");
      await router.connect(user).withdraw(
        token1.target,
        MARKET_AAVE,
        withdrawAmount,
        user.address,
        user.address,
        "0x"
      );

      const sharesAfter = await vault1.balanceOf(user.address);
      const tokenBalanceAfter = await token1.balanceOf(user.address);
      
      expect(sharesBefore - sharesAfter).to.be.greaterThan(0);
      expect(tokenBalanceAfter - tokenBalanceBefore).to.equal(withdrawAmount);
    });

    it("Should emit Withdrawn event", async function () {
      const withdrawAmount = ethers.parseEther("500");
      
      await expect(
        router.connect(user).withdraw(
          token1.target,
          MARKET_AAVE,
          withdrawAmount,
          user.address,
          user.address,
          "0x"
        )
      ).to.emit(router, "Withdrawn");
    });

    it("Should revert if vault not found", async function () {
      const MARKET_UNISWAP = ethers.encodeBytes32String("UNISWAP");
      
      await expect(
        router.connect(user).withdraw(
          token1.target,
          MARKET_UNISWAP,
          ethers.parseEther("500"),
          user.address,
          user.address,
          "0x"
        )
      ).to.be.revertedWith("BolarityRouter: Vault not found");
    });
  });

  describe("redeem", function () {
    let userShares: bigint;

    beforeEach(async function () {
      // Deposit first
      await router.connect(user).deposit(
        token1.target,
        MARKET_AAVE,
        DEPOSIT_AMOUNT,
        user.address,
        "0x"
      );
      userShares = await vault1.balanceOf(user.address);
      
      // Approve router to redeem vault shares on behalf of user
      await vault1.connect(user).approve(router.target, ethers.MaxUint256);
    });

    it("Should redeem shares from specific vault", async function () {
      const tokenBalanceBefore = await token1.balanceOf(user.address);
      
      await router.connect(user).redeem(
        token1.target,
        MARKET_AAVE,
        userShares,
        user.address,
        user.address,
        "0x"
      );

      const sharesAfter = await vault1.balanceOf(user.address);
      const tokenBalanceAfter = await token1.balanceOf(user.address);
      
      expect(sharesAfter).to.equal(0);
      expect(tokenBalanceAfter).to.be.greaterThan(tokenBalanceBefore);
    });

    it("Should emit Redeemed event", async function () {
      await expect(
        router.connect(user).redeem(
          token1.target,
          MARKET_AAVE,
          userShares,
          user.address,
          user.address,
          "0x"
        )
      ).to.emit(router, "Redeemed");
    });

    it("Should redeem all shares when passing type(uint256).max", async function () {
      const tokenBalanceBefore = await token1.balanceOf(user.address);
      
      await router.connect(user).redeem(
        token1.target,
        MARKET_AAVE,
        ethers.MaxUint256,
        user.address,
        user.address,
        "0x"
      );

      const sharesAfter = await vault1.balanceOf(user.address);
      const tokenBalanceAfter = await token1.balanceOf(user.address);
      
      expect(sharesAfter).to.equal(0);
      expect(tokenBalanceAfter).to.be.greaterThan(tokenBalanceBefore);
    });
  });

  describe("depositMultiple", function () {
    it("Should deposit to multiple vaults in one transaction", async function () {
      const assets = [token1.target, token2.target];
      const markets = [MARKET_AAVE, MARKET_COMPOUND];
      const amounts = [DEPOSIT_AMOUNT, DEPOSIT_AMOUNT];

      await router.connect(user).depositMultiple(assets, markets, amounts, user.address);

      expect(await vault1.balanceOf(user.address)).to.be.greaterThan(0);
      expect(await vault2.balanceOf(user.address)).to.be.greaterThan(0);
    });

    it("Should emit multiple Deposited events", async function () {
      const assets = [token1.target, token2.target];
      const markets = [MARKET_AAVE, MARKET_COMPOUND];
      const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];

      const tx = await router.connect(user).depositMultiple(assets, markets, amounts, user.address);
      const receipt = await tx.wait();
      
      const events = receipt?.logs.filter((log: any) => {
        try {
          const parsed = router.interface.parseLog(log);
          return parsed?.name === "Deposited";
        } catch {
          return false;
        }
      });

      expect(events?.length).to.equal(2);
    });

    it("Should revert if any deposit fails", async function () {
      const assets = [token1.target, token2.target];
      const markets = [MARKET_AAVE, ethers.encodeBytes32String("INVALID")];
      const amounts = [DEPOSIT_AMOUNT, DEPOSIT_AMOUNT];

      await expect(
        router.connect(user).depositMultiple(assets, markets, amounts, user.address)
      ).to.be.revertedWith("BolarityRouter: Vault not found");
    });
  });

  describe("withdrawMultiple", function () {
    beforeEach(async function () {
      // Deposit to both vaults first
      await router.connect(user).deposit(
        token1.target,
        MARKET_AAVE,
        DEPOSIT_AMOUNT,
        user.address,
        "0x"
      );
      await router.connect(user).deposit(
        token2.target,
        MARKET_COMPOUND,
        DEPOSIT_AMOUNT,
        user.address,
        "0x"
      );
      
      // Approve router to withdraw vault shares on behalf of user
      await vault1.connect(user).approve(router.target, ethers.MaxUint256);
      await vault2.connect(user).approve(router.target, ethers.MaxUint256);
    });

    it("Should withdraw from multiple vaults in one transaction", async function () {
      const assets = [token1.target, token2.target];
      const markets = [MARKET_AAVE, MARKET_COMPOUND];
      const amounts = [ethers.parseEther("500"), ethers.parseEther("500")];

      const token1BalanceBefore = await token1.balanceOf(user.address);
      const token2BalanceBefore = await token2.balanceOf(user.address);

      await router.connect(user).withdrawMultiple(assets, markets, amounts, user.address, user.address);

      const token1BalanceAfter = await token1.balanceOf(user.address);
      const token2BalanceAfter = await token2.balanceOf(user.address);

      expect(token1BalanceAfter - token1BalanceBefore).to.equal(ethers.parseEther("500"));
      expect(token2BalanceAfter - token2BalanceBefore).to.equal(ethers.parseEther("500"));
    });

    it("Should emit multiple Withdrawn events", async function () {
      const assets = [token1.target, token2.target];
      const markets = [MARKET_AAVE, MARKET_COMPOUND];
      const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];

      const tx = await router.connect(user).withdrawMultiple(assets, markets, amounts, user.address, user.address);
      const receipt = await tx.wait();
      
      const events = receipt?.logs.filter((log: any) => {
        try {
          const parsed = router.interface.parseLog(log);
          return parsed?.name === "Withdrawn";
        } catch {
          return false;
        }
      });

      expect(events?.length).to.equal(2);
    });
  });

  describe("emergencyWithdrawAll", function () {
    beforeEach(async function () {
      // Deposit as user first, then transfer shares to router (simulate stuck funds)
      await router.connect(user).deposit(
        token1.target,
        MARKET_AAVE,
        DEPOSIT_AMOUNT,
        user.address,
        "0x"
      );
      // Transfer shares to router to simulate stuck funds
      const shares = await vault1.balanceOf(user.address);
      await vault1.connect(user).transfer(router.target, shares);
    });

    it("Should allow owner to emergency withdraw from all vaults", async function () {
      const treasuryToken1Before = await token1.balanceOf(treasury.address);
      const routerSharesBefore = await vault1.balanceOf(router.target);
      
      expect(routerSharesBefore).to.be.greaterThan(0);

      await router.emergencyWithdrawAll(token1.target, MARKET_AAVE, treasury.address);

      const treasuryToken1After = await token1.balanceOf(treasury.address);
      const routerSharesAfter = await vault1.balanceOf(router.target);

      expect(routerSharesAfter).to.equal(0);
      expect(treasuryToken1After - treasuryToken1Before).to.be.closeTo(DEPOSIT_AMOUNT, ethers.parseEther("1"));
    });

    it("Should emit EmergencyWithdraw event", async function () {
      await expect(router.emergencyWithdrawAll(token1.target, MARKET_AAVE, treasury.address))
        .to.emit(router, "EmergencyWithdraw");
    });

    it("Should revert if called by non-owner", async function () {
      await expect(
        router.connect(user).emergencyWithdrawAll(token1.target, MARKET_AAVE, treasury.address)
      ).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await router.connect(user).deposit(
        token1.target,
        MARKET_AAVE,
        DEPOSIT_AMOUNT,
        user.address,
        "0x"
      );
    });

    it("Should get vault address using vaultFor", async function () {
      const vaultAddress = await router.vaultFor(token1.target, MARKET_AAVE);
      expect(vaultAddress).to.equal(vault1.target);
    });

    it("Should get user balance in vault", async function () {
      const balance = await router.getUserBalance(token1.target, MARKET_AAVE, user.address);
      expect(balance).to.be.greaterThan(0);
    });

    it("Should get total assets in vault", async function () {
      const totalAssets = await router.getTotalAssets(token1.target, MARKET_AAVE);
      expect(totalAssets).to.be.greaterThanOrEqual(DEPOSIT_AMOUNT);
    });

    it("Should preview deposit", async function () {
      const assets = ethers.parseEther("100");
      const shares = await router.previewDeposit(token1.target, MARKET_AAVE, assets);
      expect(shares).to.be.greaterThan(0);
    });

    it("Should preview withdraw", async function () {
      const assets = ethers.parseEther("100");
      const shares = await router.previewWithdraw(token1.target, MARKET_AAVE, assets);
      expect(shares).to.be.greaterThan(0);
    });

    it("Should preview withdraw with MaxUint256", async function () {
      const userBalance = await vault1.balanceOf(user.address);
      const shares = await router.connect(user).previewWithdraw(token1.target, MARKET_AAVE, ethers.MaxUint256);
      expect(shares).to.equal(userBalance);
    });

    it("Should preview redeem", async function () {
      const shares = ethers.parseEther("100");
      const assets = await router.previewRedeem(token1.target, MARKET_AAVE, shares);
      expect(assets).to.be.greaterThan(0);
    });

    it("Should preview redeem with MaxUint256", async function () {
      const userBalance = await vault1.balanceOf(user.address);
      const expectedAssets = await vault1.previewRedeem(userBalance);
      const assets = await router.connect(user).previewRedeem(token1.target, MARKET_AAVE, ethers.MaxUint256);
      expect(assets).to.equal(expectedAssets);
    });

    it("Should return zero for non-existent vault", async function () {
      const MARKET_INVALID = ethers.encodeBytes32String("INVALID");
      const balance = await router.getUserBalance(token1.target, MARKET_INVALID, user.address);
      expect(balance).to.equal(0);
    });
  });

  describe("Pause/Unpause", function () {
    it("Should allow owner to pause router", async function () {
      await expect(router.pause())
        .to.emit(router, "Paused")
        .withArgs(owner.address);
      
      expect(await router.paused()).to.be.true;
    });

    it("Should allow owner to unpause router", async function () {
      await router.pause();
      
      await expect(router.unpause())
        .to.emit(router, "Unpaused")
        .withArgs(owner.address);
      
      expect(await router.paused()).to.be.false;
    });

    it("Should revert deposits when paused", async function () {
      await router.pause();
      
      await expect(
        router.connect(user).deposit(
          token1.target,
          MARKET_AAVE,
          DEPOSIT_AMOUNT,
          user.address,
          "0x"
        )
      ).to.be.revertedWithCustomError(router, "EnforcedPause");
    });

    it("Should revert if non-owner tries to pause", async function () {
      await expect(
        router.connect(user).pause()
      ).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    });
  });
});