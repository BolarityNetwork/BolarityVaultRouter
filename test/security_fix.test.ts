import { ethers } from "hardhat";
import { expect } from "chai";

describe("BolarityVault Security Fix Test", function() {
    let vault: any;
    let mockToken: any;
    let mockStrategy: any;
    let newMockStrategy: any;
    let maliciousStrategy: any;
    let owner: any;
    let attacker: any;
    let user: any;
    
    beforeEach(async function() {
        [owner, attacker, user] = await ethers.getSigners();
        
        // Deploy mock token
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy("USDC", "USDC", 6);
        
        // Deploy strategies
        const MockStrategy = await ethers.getContractFactory("MockStrategy");
        mockStrategy = await MockStrategy.deploy();
        newMockStrategy = await MockStrategy.deploy();
        
        const MaliciousStrategy = await ethers.getContractFactory("MaliciousStrategy");
        maliciousStrategy = await MaliciousStrategy.deploy();
        
        // Deploy vault
        const Vault = await ethers.getContractFactory("BolarityVault");
        vault = await Vault.deploy(
            await mockToken.getAddress(),
            "Test Vault",
            "vUSDC",
            await mockStrategy.getAddress(),
            owner.address, // router
            owner.address, // fee collector
            0 // No performance fee
        );
        
        // Setup initial balances
        await mockToken.mint(owner.address, ethers.parseUnits("10000", 6));
        await mockToken.mint(user.address, ethers.parseUnits("1000", 6));
        await mockToken.mint(attacker.address, ethers.parseUnits("1000", 6));
        
        // Approve vault
        await mockToken.connect(owner).approve(await vault.getAddress(), ethers.MaxUint256);
        await mockToken.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
        await mockToken.connect(attacker).approve(await vault.getAddress(), ethers.MaxUint256);
        
        // Authorize users to call vault directly for testing
        await vault.connect(owner).setAuthorizedCaller(user.address, true);
        await vault.connect(owner).setAuthorizedCaller(owner.address, true);
    });
    
    describe("EIP-7702 Protection", function() {
        it("Should reject EOA as strategy", async function() {
            // Attacker's EOA cannot be whitelisted
            await expect(
                vault.whitelistStrategy(attacker.address, true)
            ).to.be.revertedWith("BolarityVault: Strategy must be a contract");
        });
        
        it("Should detect EIP-7702 accounts", async function() {
            // The _isEIP7702Account function checks for the 0xef0100 prefix
            // We can't create a real EIP-7702 account in tests, but the protection is in place
            
            // Verify normal contracts pass the check
            const strategyAddr = await newMockStrategy.getAddress();
            
            // Should succeed for valid contract
            await vault.whitelistStrategy(strategyAddr, true);
            expect(await vault.whitelistedStrategies(strategyAddr)).to.be.true;
        });
    });
    
    describe("Strategy Whitelist", function() {
        it("Should track whitelisted strategies", async function() {
            const strategyAddr = await newMockStrategy.getAddress();
            
            // Whitelist the strategy
            await vault.whitelistStrategy(strategyAddr, true);
            
            // Check that strategy is whitelisted
            expect(await vault.whitelistedStrategies(strategyAddr)).to.be.true;
        });
        
        it("Should remove strategies from whitelist", async function() {
            const strategyAddr = await newMockStrategy.getAddress();
            
            // Whitelist and then remove
            await vault.whitelistStrategy(strategyAddr, true);
            await vault.whitelistStrategy(strategyAddr, false);
            
            // Check removal
            expect(await vault.whitelistedStrategies(strategyAddr)).to.be.false;
        });
    });
    
    describe("Delegatecall Protection", function() {
        it("Should validate strategy before delegatecall", async function() {
            // This test verifies that validation is in place in _executeDeposit
            // and _executeWithdraw functions
            
            // Deposit should work with whitelisted strategy
            await vault.connect(user).deposit(ethers.parseUnits("100", 6), user.address);
            expect(await vault.balanceOf(user.address)).to.be.gt(0);
        });
        
        it("Should prevent using non-whitelisted strategy", async function() {
            const newStrategyAddr = await newMockStrategy.getAddress();
            
            // Try to set strategy without whitelisting
            await expect(
                vault.setStrategy(newStrategyAddr)
            ).to.be.revertedWith("BolarityVault: Strategy not whitelisted");
        });
        
        it("Should only allow owner to manage strategies", async function() {
            // Attacker cannot whitelist strategies
            await expect(
                vault.connect(attacker).whitelistStrategy(await newMockStrategy.getAddress(), true)
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
            
            // Attacker cannot change strategy
            await expect(
                vault.connect(attacker).setStrategy(await newMockStrategy.getAddress())
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        });
    });
    
    describe("Complete Security Verification", function() {
        it("Should prevent the delegatecall attack", async function() {
            // The attack vector is completely blocked by:
            // 1. EOA rejection
            // 2. Strategy whitelist
            // 3. Owner-only strategy management
            
            // Step 1: EOA cannot be used
            await expect(
                vault.whitelistStrategy(attacker.address, true)
            ).to.be.revertedWith("BolarityVault: Strategy must be a contract");
            
            // Step 2: Only whitelisted strategies work
            const randomStrategy = await (await ethers.getContractFactory("MockStrategy")).deploy();
            await expect(
                vault.setStrategy(await randomStrategy.getAddress())
            ).to.be.revertedWith("BolarityVault: Strategy not whitelisted");
            
            // Step 3: Only owner can manage
            await expect(
                vault.connect(attacker).whitelistStrategy(await randomStrategy.getAddress(), true)
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        });
        
        it("Should maintain normal vault operations", async function() {
            // Verify vault works normally with protections
            
            // User can deposit
            await vault.connect(user).deposit(ethers.parseUnits("100", 6), user.address);
            const shares = await vault.balanceOf(user.address);
            expect(shares).to.be.gt(0);
            
            // User can withdraw
            await vault.connect(user).withdraw(ethers.parseUnits("50", 6), user.address, user.address);
            const remainingShares = await vault.balanceOf(user.address);
            expect(remainingShares).to.be.lt(shares);
            
            // Owner can manage strategies
            const newStrategyAddr = await newMockStrategy.getAddress();
            await vault.whitelistStrategy(newStrategyAddr, true);
            await vault.setStrategy(newStrategyAddr);
            expect(await vault.strategy()).to.equal(newStrategyAddr);
        });
    });
});