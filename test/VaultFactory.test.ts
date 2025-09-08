import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  VaultFactory, 
  Registry, 
  BolarityVault, 
  MockERC20,
  MockStrategy
} from "../typechain-types";

describe("VaultFactory", function () {
  let factory: VaultFactory;
  let registry: Registry;
  let mockToken: MockERC20;
  let mockAavePool: any;
  let mockStrategy: MockStrategy;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let feeCollector: SignerWithAddress;

  const MARKET_AAVE = ethers.encodeBytes32String("AAVE");
  const MARKET_COMPOUND = ethers.encodeBytes32String("COMPOUND");
  const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

  beforeEach(async function () {
    [owner, nonOwner, feeCollector] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Mock Token", "MOCK", 18);
    await mockToken.waitForDeployment();

    // Deploy mock Aave pool (simulates Aave pool)
    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    mockAavePool = await MockAavePool.deploy();
    await mockAavePool.waitForDeployment();

    // Deploy mock strategy with pool address
    const MockStrategy = await ethers.getContractFactory("MockStrategy");
    mockStrategy = await MockStrategy.deploy(mockAavePool.target);
    await mockStrategy.waitForDeployment();

    // Deploy Registry
    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy(await registry.getAddress());
    await factory.waitForDeployment();

    // Transfer registry ownership to factory so it can register vaults
    await registry.transferOwnership(await factory.getAddress());
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("Should set the registry address", async function () {
      expect(await factory.registry()).to.equal(await registry.getAddress());
    });

    it("Should create vault implementation", async function () {
      expect(await factory.vaultImplementation()).to.not.equal(ethers.ZeroAddress);
    });

    it("Should revert with zero registry address", async function () {
      const VaultFactory = await ethers.getContractFactory("VaultFactory");
      await expect(
        VaultFactory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("VaultFactory: Invalid registry");
    });
  });

  describe("createVault", function () {
    it("Should create a vault successfully", async function () {
      const vaultName = "Bolarity USDC AAVE Vault";
      const vaultSymbol = "bUSDC-AAVE";
      const perfFeeBps = 1000; // 10%

      await expect(
        factory.createVault(
          mockToken.target,
          MARKET_AAVE,
          mockStrategy.target,
          feeCollector.address,
          perfFeeBps,
          vaultName,
          vaultSymbol
        )
      ).to.emit(factory, "VaultDeployed");

      // Verify vault is registered in registry
      const vaultAddress = await registry.getVault(mockToken.target, MARKET_AAVE);
      expect(vaultAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("Should create different vaults for different markets", async function () {
      const vaultName1 = "Bolarity USDC AAVE Vault";
      const vaultSymbol1 = "bUSDC-AAVE";
      const vaultName2 = "Bolarity USDC Compound Vault";
      const vaultSymbol2 = "bUSDC-COMP";
      const perfFeeBps = 1000;

      // Create AAVE vault
      await factory.createVault(
        mockToken.target,
        MARKET_AAVE,
        mockStrategy.target,
        feeCollector.address,
        perfFeeBps,
        vaultName1,
        vaultSymbol1
      );

      // Create Compound vault
      await factory.createVault(
        mockToken.target,
        MARKET_COMPOUND,
        mockStrategy.target,
        feeCollector.address,
        perfFeeBps,
        vaultName2,
        vaultSymbol2
      );

      const aaveVault = await registry.getVault(mockToken.target, MARKET_AAVE);
      const compoundVault = await registry.getVault(mockToken.target, MARKET_COMPOUND);

      expect(aaveVault).to.not.equal(ethers.ZeroAddress);
      expect(compoundVault).to.not.equal(ethers.ZeroAddress);
      expect(aaveVault).to.not.equal(compoundVault);
    });

    it("Should compute deterministic address correctly", async function () {
      const computedAddress = await factory.computeVaultAddress(mockToken.target, MARKET_AAVE);

      await factory.createVault(
        mockToken.target,
        MARKET_AAVE,
        mockStrategy.target,
        feeCollector.address,
        1000,
        "Test Vault",
        "TV"
      );

      const actualAddress = await registry.getVault(mockToken.target, MARKET_AAVE);
      expect(actualAddress).to.equal(computedAddress);
    });

    it("Should revert if not called by owner", async function () {
      await expect(
        factory.connect(nonOwner).createVault(
          mockToken.target,
          MARKET_AAVE,
          mockStrategy.target,
          feeCollector.address,
          1000,
          "Test Vault",
          "TV"
        )
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount")
        .withArgs(nonOwner.address);
    });

    it("Should revert with invalid asset", async function () {
      await expect(
        factory.createVault(
          ethers.ZeroAddress,
          MARKET_AAVE,
          mockStrategy.target,
          feeCollector.address,
          1000,
          "Test Vault",
          "TV"
        )
      ).to.be.revertedWith("VaultFactory: Invalid asset");
    });

    it("Should revert with invalid market", async function () {
      await expect(
        factory.createVault(
          mockToken.target,
          ZERO_BYTES32,
          mockStrategy.target,
          feeCollector.address,
          1000,
          "Test Vault",
          "TV"
        )
      ).to.be.revertedWith("VaultFactory: Invalid market");
    });

    it("Should revert with invalid strategy", async function () {
      await expect(
        factory.createVault(
          mockToken.target,
          MARKET_AAVE,
          ethers.ZeroAddress,
          feeCollector.address,
          1000,
          "Test Vault",
          "TV"
        )
      ).to.be.revertedWith("VaultFactory: Invalid strategy");
    });

    it("Should revert with invalid fee collector", async function () {
      await expect(
        factory.createVault(
          mockToken.target,
          MARKET_AAVE,
          mockStrategy.target,
          ethers.ZeroAddress,
          1000,
          "Test Vault",
          "TV"
        )
      ).to.be.revertedWith("VaultFactory: Invalid fee collector");
    });

    it("Should revert when trying to create same vault twice", async function () {
      await factory.createVault(
        mockToken.target,
        MARKET_AAVE,
        mockStrategy.target,
        feeCollector.address,
        1000,
        "Test Vault",
        "TV"
      );

      await expect(
        factory.createVault(
          mockToken.target,
          MARKET_AAVE,
          mockStrategy.target,
          feeCollector.address,
          1000,
          "Test Vault 2",
          "TV2"
        )
      ).to.be.reverted;
    });
  });

  describe("Registry Ownership Recovery", function () {
    it("Should allow owner to recover registry ownership", async function () {
      expect(await registry.owner()).to.equal(await factory.getAddress());
      
      await factory.recoverRegistryOwnership();
      
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("Should revert if non-owner tries to recover registry ownership", async function () {
      await expect(
        factory.connect(nonOwner).recoverRegistryOwnership()
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount")
        .withArgs(nonOwner.address);
    });
  });

  describe("Vault Properties", function () {
    it("Should initialize vault with correct parameters", async function () {
      const vaultName = "Bolarity USDC AAVE Vault";
      const vaultSymbol = "bUSDC-AAVE";
      const perfFeeBps = 1500;

      await factory.createVault(
        mockToken.target,
        MARKET_AAVE,
        mockStrategy.target,
        feeCollector.address,
        perfFeeBps,
        vaultName,
        vaultSymbol
      );

      const vaultAddress = await registry.getVault(mockToken.target, MARKET_AAVE);
      const vault = await ethers.getContractAt("BolarityVault", vaultAddress);
      
      expect(await vault.name()).to.equal(vaultName);
      expect(await vault.symbol()).to.equal(vaultSymbol);
      expect(await vault.asset()).to.equal(mockToken.target);
      expect(await vault.strategy()).to.equal(mockStrategy.target);
      expect(await vault.feeCollector()).to.equal(feeCollector.address);
      expect(await vault.perfFeeBps()).to.equal(perfFeeBps);
      expect(await vault.owner()).to.equal(owner.address);
    });
  });

  describe("Events", function () {
    it("Should emit VaultDeployed event with correct parameters", async function () {
      const vaultName = "Test Vault";
      const vaultSymbol = "TV";
      const perfFeeBps = 1000;

      const computedAddress = await factory.computeVaultAddress(mockToken.target, MARKET_AAVE);

      await expect(
        factory.createVault(
          mockToken.target,
          MARKET_AAVE,
          mockStrategy.target,
          feeCollector.address,
          perfFeeBps,
          vaultName,
          vaultSymbol
        )
      ).to.emit(factory, "VaultDeployed")
        .withArgs(
          mockToken.target,
          MARKET_AAVE,
          computedAddress,
          mockStrategy.target,
          vaultName,
          vaultSymbol
        );
    });
  });
});