import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Strategy Factory and Circular Dependency Fix", function () {
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let feeCollector: SignerWithAddress;
  
  let registry: Contract;
  let strategyFactory: Contract;
  let vaultFactory: Contract;
  let router: Contract;
  let mockToken: Contract;
  let mockAavePool: Contract;
  let mockAToken: Contract;

  beforeEach(async function () {
    [owner, user, feeCollector] = await ethers.getSigners();

    // Deploy mock token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock USDC", "mUSDC", 6);
    await mockToken.waitForDeployment();

    // Deploy mock Aave pool
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAavePool = await MockAavePool.deploy();
    await mockAavePool.waitForDeployment();

    // Deploy mock aToken
    const MockAToken = await ethers.getContractFactory("MockAToken");
    mockAToken = await MockAToken.deploy(mockToken.target, "Mock aUSDC", "maUSDC");
    await mockAToken.waitForDeployment();

    // Deploy core contracts
    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    const StrategyFactory = await ethers.getContractFactory("StrategyFactory");
    strategyFactory = await StrategyFactory.deploy();
    await strategyFactory.waitForDeployment();

    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    vaultFactory = await VaultFactory.deploy(registry.target);
    await vaultFactory.waitForDeployment();

    const BolarityRouter = await ethers.getContractFactory("BolarityRouter");
    router = await BolarityRouter.deploy(registry.target, vaultFactory.target);
    await router.waitForDeployment();

    // Setup: Transfer Registry ownership to VaultFactory
    await registry.transferOwnership(vaultFactory.target);
    
    // Setup: Set Router in VaultFactory
    await vaultFactory.setRouter(router.target);
  });

  describe("Strategy Deployment without Circular Dependency", function () {
    it("Should deploy AaveStrategy without requiring vault address", async function () {
      // Deploy Aave strategy - Note: No vault address required!
      const tx = await strategyFactory.deployAaveStrategy(mockAavePool.target);
      const receipt = await tx.wait();
      
      // Get strategy address from event
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = strategyFactory.interface.parseLog(log);
          return parsed?.name === "StrategyDeployed";
        } catch {
          return false;
        }
      });
      
      expect(event).to.not.be.undefined;
      
      const strategyId = await strategyFactory.computeAaveStrategyId(mockAavePool.target);
      const strategyAddress = await strategyFactory.getStrategy(strategyId);
      
      expect(strategyAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Should register multiple aTokens for different assets", async function () {
      // Deploy strategy
      await strategyFactory.deployAaveStrategy(mockAavePool.target);
      const strategyId = await strategyFactory.computeAaveStrategyId(mockAavePool.target);
      const strategyAddress = await strategyFactory.getStrategy(strategyId);
      
      // Deploy second mock token and aToken
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const mockToken2 = await MockERC20.deploy("Mock WETH", "mWETH", 18);
      await mockToken2.waitForDeployment();
      
      const MockAToken = await ethers.getContractFactory("MockAToken");
      const mockAToken2 = await MockAToken.deploy(mockToken2.target, "Mock aWETH", "maWETH");
      await mockAToken2.waitForDeployment();
      
      // Register both aTokens
      await strategyFactory.registerATokenForStrategy(strategyId, mockToken.target, mockAToken.target);
      await strategyFactory.registerATokenForStrategy(strategyId, mockToken2.target, mockAToken2.target);
      
      // Verify registrations
      const AaveStrategy = await ethers.getContractFactory("AaveStrategy");
      const strategy = AaveStrategy.attach(strategyAddress);
      
      expect(await strategy.aTokens(mockToken.target)).to.equal(mockAToken.target);
      expect(await strategy.aTokens(mockToken2.target)).to.equal(mockAToken2.target);
    });

    it("Should create vault with pre-deployed strategy", async function () {
      // First deploy strategy
      await strategyFactory.deployAaveStrategy(mockAavePool.target);
      const strategyId = await strategyFactory.computeAaveStrategyId(mockAavePool.target);
      const strategyAddress = await strategyFactory.getStrategy(strategyId);
      
      // Register aToken
      await strategyFactory.registerATokenForStrategy(strategyId, mockToken.target, mockAToken.target);
      
      // Now create vault using the strategy
      const market = ethers.encodeBytes32String("AAVE-V3");
      await vaultFactory.createVault(
        mockToken.target,
        market,
        strategyAddress,
        feeCollector.address,
        2000, // 20% performance fee
        "Bolarity USDC Vault",
        "bUSDC"
      );
      
      // Verify vault was created
      const vaultAddress = await registry.getVault(mockToken.target, market);
      expect(vaultAddress).to.not.equal(ethers.ZeroAddress);
      
      // Verify vault uses the correct strategy
      const BolarityVault = await ethers.getContractFactory("BolarityVault");
      const vault = BolarityVault.attach(vaultAddress);
      expect(await vault.strategy()).to.equal(strategyAddress);
    });
  });

  describe("Multi-Asset Support", function () {
    it("Should support multiple assets in same strategy", async function () {
      // Deploy strategy
      await strategyFactory.deployAaveStrategy(mockAavePool.target);
      const strategyId = await strategyFactory.computeAaveStrategyId(mockAavePool.target);
      const strategyAddress = await strategyFactory.getStrategy(strategyId);
      
      // Register multiple assets
      const assets = [];
      const aTokens = [];
      
      for (let i = 0; i < 3; i++) {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token = await MockERC20.deploy(`Token${i}`, `TK${i}`, 18);
        await token.waitForDeployment();
        
        const MockAToken = await ethers.getContractFactory("MockAToken");
        const aToken = await MockAToken.deploy(token.target, `aToken${i}`, `aTK${i}`);
        await aToken.waitForDeployment();
        
        assets.push(token);
        aTokens.push(aToken);
        
        await strategyFactory.registerATokenForStrategy(strategyId, token.target, aToken.target);
      }
      
      // Create vaults for each asset using the same strategy
      for (let i = 0; i < assets.length; i++) {
        const market = ethers.encodeBytes32String("AAVE-V3");
        await vaultFactory.createVault(
          assets[i].target,
          market,
          strategyAddress,
          feeCollector.address,
          2000,
          `Vault${i}`,
          `V${i}`
        );
        
        const vaultAddress = await registry.getVault(assets[i].target, market);
        expect(vaultAddress).to.not.equal(ethers.ZeroAddress);
        
        // Each vault uses the same strategy
        const BolarityVault = await ethers.getContractFactory("BolarityVault");
        const vault = BolarityVault.attach(vaultAddress);
        expect(await vault.strategy()).to.equal(strategyAddress);
      }
    });
  });
});