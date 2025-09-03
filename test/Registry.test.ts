import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Registry } from "../typechain-types";

describe("Registry", function () {
  let registry: Registry;
  let owner: SignerWithAddress;
  let nonOwner: SignerWithAddress;
  let vault1: SignerWithAddress;
  let vault2: SignerWithAddress;
  let asset1: SignerWithAddress;
  let asset2: SignerWithAddress;

  const MARKET_AAVE = ethers.encodeBytes32String("AAVE");
  const MARKET_COMPOUND = ethers.encodeBytes32String("COMPOUND");
  const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

  beforeEach(async function () {
    [owner, nonOwner, vault1, vault2, asset1, asset2] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();
    await registry.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });
  });

  describe("registerVault", function () {
    it("Should register a vault successfully", async function () {
      await expect(registry.registerVault(asset1.address, MARKET_AAVE, vault1.address))
        .to.emit(registry, "VaultRegistered")
        .withArgs(asset1.address, MARKET_AAVE, vault1.address);

      expect(await registry.getVault(asset1.address, MARKET_AAVE)).to.equal(vault1.address);
    });

    it("Should register multiple vaults for different assets and markets", async function () {
      await registry.registerVault(asset1.address, MARKET_AAVE, vault1.address);
      await registry.registerVault(asset1.address, MARKET_COMPOUND, vault2.address);
      await registry.registerVault(asset2.address, MARKET_AAVE, vault2.address);

      expect(await registry.getVault(asset1.address, MARKET_AAVE)).to.equal(vault1.address);
      expect(await registry.getVault(asset1.address, MARKET_COMPOUND)).to.equal(vault2.address);
      expect(await registry.getVault(asset2.address, MARKET_AAVE)).to.equal(vault2.address);
    });

    it("Should revert if not called by owner", async function () {
      await expect(
        registry.connect(nonOwner).registerVault(asset1.address, MARKET_AAVE, vault1.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(nonOwner.address);
    });

    it("Should revert with invalid asset address", async function () {
      await expect(
        registry.registerVault(ethers.ZeroAddress, MARKET_AAVE, vault1.address)
      ).to.be.revertedWith("Registry: Invalid asset");
    });

    it("Should revert with invalid market", async function () {
      await expect(
        registry.registerVault(asset1.address, ZERO_BYTES32, vault1.address)
      ).to.be.revertedWith("Registry: Invalid market");
    });

    it("Should revert with invalid vault address", async function () {
      await expect(
        registry.registerVault(asset1.address, MARKET_AAVE, ethers.ZeroAddress)
      ).to.be.revertedWith("Registry: Invalid vault");
    });

    it("Should revert if vault already registered", async function () {
      await registry.registerVault(asset1.address, MARKET_AAVE, vault1.address);
      
      await expect(
        registry.registerVault(asset1.address, MARKET_AAVE, vault2.address)
      ).to.be.revertedWith("Registry: Vault already registered");
    });
  });

  describe("setPreferredMarket", function () {
    beforeEach(async function () {
      await registry.registerVault(asset1.address, MARKET_AAVE, vault1.address);
      await registry.registerVault(asset1.address, MARKET_COMPOUND, vault2.address);
    });

    it("Should set preferred market successfully", async function () {
      await expect(registry.setPreferredMarket(asset1.address, MARKET_AAVE))
        .to.emit(registry, "PreferredMarketSet")
        .withArgs(asset1.address, MARKET_AAVE);

      expect(await registry.getPreferredMarket(asset1.address)).to.equal(MARKET_AAVE);
    });

    it("Should update preferred market", async function () {
      await registry.setPreferredMarket(asset1.address, MARKET_AAVE);
      expect(await registry.getPreferredMarket(asset1.address)).to.equal(MARKET_AAVE);

      await registry.setPreferredMarket(asset1.address, MARKET_COMPOUND);
      expect(await registry.getPreferredMarket(asset1.address)).to.equal(MARKET_COMPOUND);
    });

    it("Should revert if not called by owner", async function () {
      await expect(
        registry.connect(nonOwner).setPreferredMarket(asset1.address, MARKET_AAVE)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(nonOwner.address);
    });

    it("Should revert with invalid asset address", async function () {
      await expect(
        registry.setPreferredMarket(ethers.ZeroAddress, MARKET_AAVE)
      ).to.be.revertedWith("Registry: Invalid asset");
    });

    it("Should revert with invalid market", async function () {
      await expect(
        registry.setPreferredMarket(asset1.address, ZERO_BYTES32)
      ).to.be.revertedWith("Registry: Invalid market");
    });

    it("Should revert if vault not registered", async function () {
      const MARKET_UNISWAP = ethers.encodeBytes32String("UNISWAP");
      
      await expect(
        registry.setPreferredMarket(asset1.address, MARKET_UNISWAP)
      ).to.be.revertedWith("Registry: Vault not registered");
    });
  });

  describe("View Functions", function () {
    it("Should return zero address for unregistered vault", async function () {
      expect(await registry.getVault(asset1.address, MARKET_AAVE)).to.equal(ethers.ZeroAddress);
    });

    it("Should return empty bytes32 for asset without preferred market", async function () {
      expect(await registry.getPreferredMarket(asset1.address)).to.equal(ZERO_BYTES32);
    });
  });
});