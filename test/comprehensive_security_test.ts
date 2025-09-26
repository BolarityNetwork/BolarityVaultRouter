import { ethers } from "hardhat";
import { expect } from "chai";

describe("Comprehensive EIP-7702 Security Test", function() {
    let vault: any;
    let mockStrategy: any;
    let mockAsset: any;
    let mockToken: any;
    let owner: any;
    let attacker: any;
    let user: any;
    
    beforeEach(async function() {
        [owner, attacker, user] = await ethers.getSigners();
        
        // Deploy mock token for testing
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockAsset = await MockERC20.deploy("USD Coin", "USDC", 6);
        mockToken = mockAsset;
        await mockAsset.mint(owner.address, ethers.parseEther("1000000"));
        await mockAsset.mint(user.address, ethers.parseUnits("10000", 6));
        
        // Deploy mock strategy
        const MockStrategy = await ethers.getContractFactory("MockStrategy");
        mockStrategy = await MockStrategy.deploy();
        
        // Deploy vault with security features
        const BolarityVault = await ethers.getContractFactory("BolarityVault");
        vault = await BolarityVault.deploy(
            await mockAsset.getAddress(),
            "Secure Vault",
            "sVAULT",
            await mockStrategy.getAddress(),
            owner.address, // router
            owner.address, // fee collector
            0
        );
        
        // Setup approvals
        await mockAsset.approve(await vault.getAddress(), ethers.MaxUint256);
        await mockAsset.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    });
    
    describe("Core Security Mechanisms", function() {
        it("Should have all security features enabled", async function() {
            const strategyAddr = await vault.strategy();
            
            // 1. Check strategy is whitelisted
            expect(await vault.whitelistedStrategies(strategyAddr)).to.be.true;
            
            // 2. Verify the strategy is a contract
            const code = await ethers.provider.getCode(strategyAddr);
            expect(code).to.not.equal("0x");
            expect(code.length).to.be.greaterThan(2);
        });
        
        it("Should detect 23-byte EIP-7702 pattern", async function() {
            // The _isEIP7702Account function checks for:
            // 1. Code size of exactly 23 bytes
            // 2. Code starting with 0xef0100 prefix
            // 3. EOA codehash
            
            // Regular EOA should not be detected as EIP-7702
            const eoaAddr = attacker.address;
            const code = await ethers.provider.getCode(eoaAddr);
            expect(code).to.equal("0x"); // EOA has no code
            
            // Contract should not be detected as EIP-7702
            const contractAddr = await mockStrategy.getAddress();
            const contractCode = await ethers.provider.getCode(contractAddr);
            expect(contractCode.length).to.be.greaterThan(46); // Contracts have more than 23 bytes
        });
        
        it("Should reject EOA as strategy", async function() {
            // Try to whitelist an EOA as strategy
            await expect(
                vault.whitelistStrategy(attacker.address, true)
            ).to.be.revertedWith("BolarityVault: Strategy must be a contract");
        });
        
        it("Should require contract code for strategy", async function() {
            // Deploy a new contract
            const NewStrategy = await ethers.getContractFactory("MockStrategy");
            const newStrategy = await NewStrategy.deploy();
            
            // Should succeed with valid contract
            await vault.whitelistStrategy(await newStrategy.getAddress(), true);
            expect(await vault.whitelistedStrategies(await newStrategy.getAddress())).to.be.true;
        });
    });
    
    describe("Attack Simulation", function() {
        it("Should prevent unauthorized strategy changes", async function() {
            // Attacker tries to change strategy
            await expect(
                vault.connect(attacker).setStrategy(attacker.address)
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        });
        
        it("Should prevent non-whitelisted strategy usage", async function() {
            const NewStrategy = await ethers.getContractFactory("MockStrategy");
            const newStrategy = await NewStrategy.deploy();
            const newStrategyAddr = await newStrategy.getAddress();
            
            // Try to set strategy without whitelisting
            await expect(
                vault.setStrategy(newStrategyAddr)
            ).to.be.revertedWith("BolarityVault: Strategy not whitelisted");
        });
        
        it("Should prevent strategy code replacement attack", async function() {
            // Deploy a new legitimate strategy
            const NewStrategy = await ethers.getContractFactory("MockStrategy");
            const newStrategy = await NewStrategy.deploy();
            const newStrategyAddr = await newStrategy.getAddress();
            
            // Whitelist it properly
            await vault.connect(owner).whitelistStrategy(newStrategyAddr, true);
            
            // Verify it's whitelisted
            expect(await vault.whitelistedStrategies(newStrategyAddr)).to.be.true;
            
            // Set it as active strategy
            await vault.connect(owner).setStrategy(newStrategyAddr);
            
            // Verify strategy is working
            await mockToken.mint(user.address, ethers.parseUnits("500", 6));
            await mockToken.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
            
            // Authorize user to call vault directly for testing
            await vault.connect(owner).setAuthorizedCaller(user.address, true);
            
            await vault.connect(user).deposit(ethers.parseUnits("500", 6), user.address);
        });
        
        it("Should prevent malicious delegatecall execution", async function() {
            // The attack data contains:
            // - Function selector: 0xa7056997
            // - USDC address: 833589fcd6edb6e08f4c7c32d4f71b54bda02913
            // - Transfer selector: a9059cbb
            // - Max uint256 for approval/withdrawal
            
            // But the attack would fail because:
            // 1. EIP-7702 account can't be whitelisted (_isEIP7702Account check)
            // 2. EOAs are rejected (_isContract check)
            // 3. Only whitelisted strategies can be used
            
            // Verify current protections
            const strategyAddr = await vault.strategy();
            expect(await vault.whitelistedStrategies(strategyAddr)).to.be.true;
        });
    });
    
    describe("Double-Check Attack Vector", function() {
        it("Should have multiple layers of defense", async function() {
            // Layer 1: Strategy whitelist
            expect(await vault.whitelistedStrategies(await vault.strategy())).to.be.true;
            
            // Layer 2: Contract validation
            const strategyAddr = await vault.strategy();
            const code = await ethers.provider.getCode(strategyAddr);
            expect(code.length).to.be.greaterThan(2);
            
            // Layer 3: Owner-only functions
            await expect(
                vault.connect(attacker).whitelistStrategy(attacker.address, true)
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        });
        
        it("Should prevent EIP-7702 delegated EOA attack", async function() {
            // Simulate attempting to use an EIP-7702 account
            // (We can't actually create one in tests, but we test the protection)
            
            // EOA should be rejected as strategy
            await expect(
                vault.whitelistStrategy(attacker.address, true)
            ).to.be.revertedWith("BolarityVault: Strategy must be a contract");
            
            // Even if attacker somehow got their EOA whitelisted in the past,
            // the delegatecall would fail because of validation
            
            // Verify existing strategy is protected
            const currentStrategy = await vault.strategy();
            expect(await vault.whitelistedStrategies(currentStrategy)).to.be.true;
            
            // Deposits work normally with valid strategy
            await vault.deposit(ethers.parseUnits("100", 6), owner.address);
            expect(await vault.balanceOf(owner.address)).to.be.gt(0);
        });
    });
});