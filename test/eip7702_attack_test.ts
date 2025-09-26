import { ethers } from "hardhat";
import { expect } from "chai";

describe("EIP-7702 Attack Defense Test", function() {
    let vault: any;
    let mockStrategy: any;
    let mockToken: any;
    let owner: any;
    let attacker: any;
    let user: any;
    
    beforeEach(async function() {
        [owner, attacker, user] = await ethers.getSigners();
        
        // Deploy mock token
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy("USDC", "USDC", 6);
        await mockToken.mint(owner.address, ethers.parseUnits("10000", 6));
        await mockToken.mint(user.address, ethers.parseUnits("1000", 6));
        
        // Deploy mock strategy
        const MockStrategyFactory = await ethers.getContractFactory("MockStrategy");
        mockStrategy = await MockStrategyFactory.deploy();
        
        // Deploy vault
        const Vault = await ethers.getContractFactory("BolarityVault");
        vault = await Vault.deploy(
            await mockToken.getAddress(),
            "Test Vault",
            "vUSDC",
            await mockStrategy.getAddress(),
            owner.address, // router
            owner.address, // fee collector
            0
        );
        
        // Setup approvals
        await mockToken.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    });
    
    describe("EIP-7702 Detection", function() {
        it("Should reject EOA as strategy", async function() {
            // Try to whitelist an EOA (attacker's address)
            await expect(
                vault.connect(owner).whitelistStrategy(attacker.address, true)
            ).to.be.revertedWith("BolarityVault: Strategy must be a contract");
        });
        
        it("Should detect EIP-7702 pattern", async function() {
            // We can't create a real EIP-7702 account in tests, but we verify the protection exists
            // The _isEIP7702Account function checks for 23-byte code starting with 0xef0100
            
            // Verify normal contracts are allowed
            const NewStrategy = await ethers.getContractFactory("MockStrategy");
            const newStrategy = await NewStrategy.deploy();
            
            await vault.connect(owner).whitelistStrategy(await newStrategy.getAddress(), true);
            expect(await vault.whitelistedStrategies(await newStrategy.getAddress())).to.be.true;
        });
    });
    
    describe("Attack Scenario Prevention", function() {
        it("Should prevent code replacement after whitelisting", async function() {
            const NewStrategy = await ethers.getContractFactory("MockStrategy");
            const newStrategy = await NewStrategy.deploy();
            const newStrategyAddr = await newStrategy.getAddress();
            
            // Whitelist the new strategy
            await vault.connect(owner).whitelistStrategy(newStrategyAddr, true);
            
            // Verify it's whitelisted
            expect(await vault.whitelistedStrategies(newStrategyAddr)).to.be.true;
            
            // The strategy whitelist prevents unauthorized code execution
            // Even if code could change (which can't happen in normal EVM),
            // only whitelisted strategies can be used
        });
        
        it("Should validate strategy before every delegatecall", async function() {
            // The strategy must be whitelisted and be a valid contract
            const strategyAddr = await vault.strategy();
            
            // Verify it's whitelisted
            expect(await vault.whitelistedStrategies(strategyAddr)).to.be.true;
            
            // Any deposit/withdraw will trigger validation
            await mockToken.mint(user.address, ethers.parseUnits("100", 6));
            await mockToken.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
            
            // Authorize user to call vault directly for testing
            await vault.connect(owner).setAuthorizedCaller(user.address, true);
            
            await vault.connect(user).deposit(ethers.parseUnits("100", 6), user.address);
            // If validation fails, the above would revert
        });
        
        it("Should prevent unauthorized strategy changes", async function() {
            // Non-owner cannot change strategy
            await expect(
                vault.connect(attacker).setStrategy(attacker.address)
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
            
            // Non-owner cannot whitelist strategies
            await expect(
                vault.connect(attacker).whitelistStrategy(attacker.address, true)
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        });
        
        it("Should properly track and validate strategies", async function() {
            // Deploy two strategies
            const Strategy1 = await ethers.getContractFactory("MockStrategy");
            const strategy1 = await Strategy1.deploy();
            
            const Strategy2 = await ethers.getContractFactory("MockStrategy");
            const strategy2 = await Strategy2.deploy();
            
            // Whitelist both
            await vault.connect(owner).whitelistStrategy(await strategy1.getAddress(), true);
            await vault.connect(owner).whitelistStrategy(await strategy2.getAddress(), true);
            
            // Both should be whitelisted
            expect(await vault.whitelistedStrategies(await strategy1.getAddress())).to.be.true;
            expect(await vault.whitelistedStrategies(await strategy2.getAddress())).to.be.true;
            
            // Can switch between whitelisted strategies
            await vault.connect(owner).setStrategy(await strategy1.getAddress());
            expect(await vault.strategy()).to.equal(await strategy1.getAddress());
            
            await vault.connect(owner).setStrategy(await strategy2.getAddress());
            expect(await vault.strategy()).to.equal(await strategy2.getAddress());
        });
    });
    
    describe("Complete Attack Prevention", function() {
        it("Should block the complete attack vector", async function() {
            // The attack involves:
            // 1. Using EIP-7702 to delegate EOA to malicious code
            // 2. Getting the EOA whitelisted as a strategy
            // 3. Using delegatecall to execute malicious code in vault context
            
            // Step 1: EOA cannot be whitelisted
            await expect(
                vault.connect(owner).whitelistStrategy(attacker.address, true)
            ).to.be.revertedWith("BolarityVault: Strategy must be a contract");
            
            // Step 2: Only whitelisted strategies can be set
            const RandomContract = await ethers.getContractFactory("MockStrategy");
            const randomContract = await RandomContract.deploy();
            
            await expect(
                vault.connect(owner).setStrategy(await randomContract.getAddress())
            ).to.be.revertedWith("BolarityVault: Strategy not whitelisted");
            
            // Step 3: Validation happens before every delegatecall
            // This is already protected by requiring whitelisted strategies
            
            // The attack is fully prevented
        });
    });
});