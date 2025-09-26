import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BolarityRouter Security Test", function() {
    let router: any;
    let registry: any;
    let factory: any;
    let vault: any;
    let mockToken: any;
    let mockStrategy: any;
    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let attacker: SignerWithAddress;
    
    const INITIAL_BALANCE = ethers.parseUnits("10000", 6);
    const DEPOSIT_AMOUNT = ethers.parseUnits("1000", 6);
    const MARKET_AAVE = ethers.encodeBytes32String("AAVE");
    
    beforeEach(async function() {
        [owner, alice, attacker] = await ethers.getSigners();
        
        // Deploy Registry
        const Registry = await ethers.getContractFactory("Registry");
        registry = await Registry.deploy();
        
        // Deploy BolarityRouter
        const BolarityRouter = await ethers.getContractFactory("BolarityRouter");
        router = await BolarityRouter.deploy(
            await registry.getAddress(),
            "0x0000000000000000000000000000000000000001" // Placeholder for factory
        );
        
        // Deploy VaultFactory
        const VaultFactory = await ethers.getContractFactory("VaultFactory");
        factory = await VaultFactory.deploy(
            await registry.getAddress(),
            await router.getAddress()
        );
        
        // Transfer registry ownership to factory
        await registry.transferOwnership(await factory.getAddress());
        
        // Deploy mock token
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy("USDC", "USDC", 6);
        
        // Deploy mock strategy
        const MockStrategy = await ethers.getContractFactory("MockStrategy");
        mockStrategy = await MockStrategy.deploy();
        
        // Create vault through factory
        await factory.createVault(
            await mockToken.getAddress(),
            MARKET_AAVE,
            await mockStrategy.getAddress(),
            owner.address, // fee collector
            0, // no performance fee
            "Test Vault",
            "vUSDC"
        );
        
        const vaultAddress = await registry.getVault(await mockToken.getAddress(), MARKET_AAVE);
        vault = await ethers.getContractAt("BolarityVault", vaultAddress);
        
        // Setup: Give users tokens
        await mockToken.mint(alice.address, INITIAL_BALANCE);
        await mockToken.mint(attacker.address, INITIAL_BALANCE);
        
        // Users approve router
        await mockToken.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
        await mockToken.connect(attacker).approve(await router.getAddress(), ethers.MaxUint256);
        
        // Alice deposits through router
        await router.connect(alice).deposit(
            await mockToken.getAddress(),
            MARKET_AAVE,
            DEPOSIT_AMOUNT,
            alice.address,
            "0x"
        );
        
        // Alice approves router to manage her vault shares (needed for withdrawals)
        await vault.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
    });
    
    describe("Withdraw Security", function() {
        it("Should allow users to withdraw their own funds", async function() {
            const aliceSharesBefore = await vault.balanceOf(alice.address);
            expect(aliceSharesBefore).to.be.gt(0);
            
            // Alice withdraws her own funds (owner == msg.sender)
            await expect(
                router.connect(alice).withdraw(
                    await mockToken.getAddress(),
                    MARKET_AAVE,
                    DEPOSIT_AMOUNT / 2n,
                    alice.address,
                    alice.address, // owner = alice, msg.sender = alice
                    "0x"
                )
            ).to.not.be.reverted;
            
            const aliceSharesAfter = await vault.balanceOf(alice.address);
            expect(aliceSharesAfter).to.be.lt(aliceSharesBefore);
        });
        
        it("Should prevent attacker from withdrawing other users' funds", async function() {
            // Attacker tries to withdraw Alice's funds by passing alice as owner
            await expect(
                router.connect(attacker).withdraw(
                    await mockToken.getAddress(),
                    MARKET_AAVE,
                    DEPOSIT_AMOUNT / 2n,
                    attacker.address, // receiver = attacker
                    alice.address, // owner = alice, but msg.sender = attacker
                    "0x"
                )
            ).to.be.revertedWith("BolarityRouter: Owner must be msg.sender");
        });
        
        it("Should prevent using router as owner to bypass checks", async function() {
            // Attacker tries to use router's address as owner
            await expect(
                router.connect(attacker).withdraw(
                    await mockToken.getAddress(),
                    MARKET_AAVE,
                    DEPOSIT_AMOUNT / 2n,
                    attacker.address,
                    await router.getAddress(), // owner = router
                    "0x"
                )
            ).to.be.revertedWith("BolarityRouter: Owner must be msg.sender");
        });
    });
    
    describe("Redeem Security", function() {
        it("Should allow users to redeem their own shares", async function() {
            const aliceShares = await vault.balanceOf(alice.address);
            expect(aliceShares).to.be.gt(0);
            
            // Alice redeems her own shares (owner == msg.sender)
            await expect(
                router.connect(alice).redeem(
                    await mockToken.getAddress(),
                    MARKET_AAVE,
                    aliceShares / 2n,
                    alice.address,
                    alice.address, // owner = alice, msg.sender = alice
                    "0x"
                )
            ).to.not.be.reverted;
            
            const aliceSharesAfter = await vault.balanceOf(alice.address);
            expect(aliceSharesAfter).to.equal(aliceShares / 2n);
        });
        
        it("Should prevent attacker from redeeming other users' shares", async function() {
            const aliceShares = await vault.balanceOf(alice.address);
            
            // Attacker tries to redeem Alice's shares
            await expect(
                router.connect(attacker).redeem(
                    await mockToken.getAddress(),
                    MARKET_AAVE,
                    aliceShares,
                    attacker.address, // receiver = attacker
                    alice.address, // owner = alice, but msg.sender = attacker
                    "0x"
                )
            ).to.be.revertedWith("BolarityRouter: Owner must be msg.sender");
        });
    });
    
    describe("WithdrawMultiple Security", function() {
        beforeEach(async function() {
            // Setup second token and vault
            const MockToken2 = await ethers.getContractFactory("MockERC20");
            const token2 = await MockToken2.deploy("USDT", "USDT", 6);
            
            const MARKET_COMPOUND = ethers.encodeBytes32String("COMPOUND");
            
            await factory.createVault(
                await token2.getAddress(),
                MARKET_COMPOUND,
                await mockStrategy.getAddress(),
                owner.address,
                0,
                "Test Vault 2",
                "vUSDT"
            );
            
            // Alice deposits to second vault too
            await token2.mint(alice.address, INITIAL_BALANCE);
            await token2.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
            
            await router.connect(alice).deposit(
                await token2.getAddress(),
                MARKET_COMPOUND,
                DEPOSIT_AMOUNT,
                alice.address,
                "0x"
            );
            
            // Get vault2 and approve router to manage Alice's shares in vault2
            const vault2Address = await registry.getVault(await token2.getAddress(), MARKET_COMPOUND);
            const vault2 = await ethers.getContractAt("BolarityVault", vault2Address);
            await vault2.connect(alice).approve(await router.getAddress(), ethers.MaxUint256);
        });
        
        it("Should prevent attacker from withdrawing multiple vaults of other users", async function() {
            const assets = [await mockToken.getAddress()];
            const markets = [MARKET_AAVE];
            const amounts = [DEPOSIT_AMOUNT / 2n];
            
            // Attacker tries to withdraw from Alice's vaults
            await expect(
                router.connect(attacker).withdrawMultiple(
                    assets,
                    markets,
                    amounts,
                    attacker.address, // receiver = attacker
                    alice.address // owner = alice, but msg.sender = attacker
                )
            ).to.be.revertedWith("BolarityRouter: Owner must be msg.sender");
        });
        
        it("Should allow users to withdraw from multiple vaults", async function() {
            const assets = [await mockToken.getAddress()];
            const markets = [MARKET_AAVE];
            const amounts = [DEPOSIT_AMOUNT / 2n];
            
            const aliceBalanceBefore = await mockToken.balanceOf(alice.address);
            
            // Alice withdraws from her own vaults
            await expect(
                router.connect(alice).withdrawMultiple(
                    assets,
                    markets,
                    amounts,
                    alice.address,
                    alice.address // owner = alice, msg.sender = alice
                )
            ).to.not.be.reverted;
            
            const aliceBalanceAfter = await mockToken.balanceOf(alice.address);
            expect(aliceBalanceAfter - aliceBalanceBefore).to.equal(DEPOSIT_AMOUNT / 2n);
        });
    });
    
    describe("Direct Vault Attack Prevention", function() {
        it("Should prevent direct vault withdrawal attack", async function() {
            // Even if attacker is authorized to call vault, they still can't withdraw Alice's funds
            // because the vault properly checks allowances
            
            // First authorize the attacker to bypass the onlyAuthorizedOrPublic check
            await vault.connect(owner).setAuthorizedCaller(attacker.address, true);
            
            await expect(
                vault.connect(attacker).withdraw(
                    DEPOSIT_AMOUNT / 2n,
                    attacker.address,
                    alice.address // trying to withdraw from alice
                )
            ).to.be.revertedWith("BolarityVault: Insufficient allowance");
        });
        
        it("Should prevent direct vault redeem attack", async function() {
            const aliceShares = await vault.balanceOf(alice.address);
            
            // First authorize the attacker to bypass the onlyAuthorizedOrPublic check
            await vault.connect(owner).setAuthorizedCaller(attacker.address, true);
            
            // Even if attacker is authorized to call vault, they still can't redeem Alice's shares
            await expect(
                vault.connect(attacker).redeem(
                    aliceShares,
                    attacker.address,
                    alice.address // trying to redeem alice's shares
                )
            ).to.be.revertedWith("BolarityVault: Insufficient allowance");
        });
    });
});