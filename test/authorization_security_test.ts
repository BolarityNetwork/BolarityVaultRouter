import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Authorization Security Fix Test", function() {
    let vault: any;
    let mockToken: any;
    let mockStrategy: any;
    let router: any;
    let owner: SignerWithAddress;
    let authorizedCaller: SignerWithAddress;
    let unauthorizedCaller: SignerWithAddress;
    let user: SignerWithAddress;
    
    beforeEach(async function() {
        [owner, authorizedCaller, unauthorizedCaller, user] = await ethers.getSigners();
        
        // Deploy mock token
        const MockToken = await ethers.getContractFactory("MockERC20");
        mockToken = await MockToken.deploy("USDC", "USDC", 6);
        
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
            owner.address, // router (using owner for this test)
            owner.address, // fee collector
            0 // No performance fee
        );
        
        // Deploy mock router
        const MockRouter = await ethers.getContractFactory("MockRouter");
        router = await MockRouter.deploy();
        
        // Set router in vault
        await vault.setRouter(await router.getAddress());
        
        // Setup: Give users tokens
        await mockToken.mint(user.address, ethers.parseUnits("10000", 6));
        await mockToken.mint(unauthorizedCaller.address, ethers.parseUnits("10000", 6));
        await mockToken.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
        await mockToken.connect(unauthorizedCaller).approve(await vault.getAddress(), ethers.MaxUint256);
    });
    
    describe("Authorization Controls", function() {
        it("Should allow owner to perform operations", async function() {
            await mockToken.mint(owner.address, ethers.parseUnits("1000", 6));
            await mockToken.connect(owner).approve(await vault.getAddress(), ethers.MaxUint256);
            
            // Owner should be able to deposit
            await expect(
                vault.connect(owner).deposit(ethers.parseUnits("100", 6), owner.address)
            ).to.not.be.reverted;
        });
        
        it("Should allow router to perform operations", async function() {
            // Set authorizedCaller as router for this test
            await vault.setRouter(authorizedCaller.address);
            
            await mockToken.mint(authorizedCaller.address, ethers.parseUnits("1000", 6));
            await mockToken.connect(authorizedCaller).approve(await vault.getAddress(), ethers.MaxUint256);
            
            // Router should be able to deposit
            await expect(
                vault.connect(authorizedCaller).deposit(ethers.parseUnits("100", 6), authorizedCaller.address)
            ).to.not.be.reverted;
        });
        
        it("Should allow direct user calls (EOA) when authorized", async function() {
            // Authorize the user first
            await vault.connect(owner).setAuthorizedCaller(user.address, true);
            
            // Direct user call should be allowed after authorization
            await expect(
                vault.connect(user).deposit(ethers.parseUnits("100", 6), user.address)
            ).to.not.be.reverted;
        });
        
        it("Should allow authorized callers to perform operations", async function() {
            // Authorize a specific caller
            await vault.connect(owner).setAuthorizedCaller(authorizedCaller.address, true);
            
            await mockToken.mint(authorizedCaller.address, ethers.parseUnits("1000", 6));
            await mockToken.connect(authorizedCaller).approve(await vault.getAddress(), ethers.MaxUint256);
            
            // Authorized caller should be able to deposit
            await expect(
                vault.connect(authorizedCaller).deposit(ethers.parseUnits("100", 6), authorizedCaller.address)
            ).to.not.be.reverted;
        });
        
        it("Should block unauthorized contract calls", async function() {
            // Deploy a malicious contract that tries to call vault
            const MaliciousContract = await ethers.getContractFactory("MaliciousContract");
            const malicious = await MaliciousContract.deploy(await vault.getAddress());
            
            await mockToken.mint(await malicious.getAddress(), ethers.parseUnits("1000", 6));
            
            // Malicious contract should be blocked (tx.origin != msg.sender and not authorized)
            await expect(
                malicious.attemptDeposit(await mockToken.getAddress(), ethers.parseUnits("100", 6))
            ).to.be.revertedWith("BolarityVault: Unauthorized");
        });
        
        it("Should use allowance mechanism for withdraw", async function() {
            // First authorize and deposit as user
            await vault.connect(owner).setAuthorizedCaller(user.address, true);
            await vault.connect(user).deposit(ethers.parseUnits("100", 6), user.address);
            
            // Deploy malicious contract
            const MaliciousContract = await ethers.getContractFactory("MaliciousContract");
            const malicious = await MaliciousContract.deploy(await vault.getAddress());
            
            // Authorize the malicious contract to bypass onlyAuthorizedOrPublic, so we can test allowance check
            await vault.connect(owner).setAuthorizedCaller(await malicious.getAddress(), true);
            
            // Malicious contract cannot withdraw without allowance (uses allowance check after authorization check)
            await expect(
                malicious.attemptWithdraw(ethers.parseUnits("50", 6), await malicious.getAddress(), user.address)
            ).to.be.revertedWith("BolarityVault: Insufficient allowance");
        });
        
        it("Should protect mint function", async function() {
            // Deploy malicious contract
            const MaliciousContract = await ethers.getContractFactory("MaliciousContract");
            const malicious = await MaliciousContract.deploy(await vault.getAddress());
            
            await mockToken.mint(await malicious.getAddress(), ethers.parseUnits("1000", 6));
            
            // Malicious contract should not be able to mint
            await expect(
                malicious.attemptMint(await mockToken.getAddress(), ethers.parseUnits("100", 6))
            ).to.be.revertedWith("BolarityVault: Unauthorized");
        });
        
        it("Should use allowance mechanism for redeem", async function() {
            // First authorize and deposit as user
            await vault.connect(owner).setAuthorizedCaller(user.address, true);
            await vault.connect(user).deposit(ethers.parseUnits("100", 6), user.address);
            const shares = await vault.balanceOf(user.address);
            
            // Deploy malicious contract
            const MaliciousContract = await ethers.getContractFactory("MaliciousContract");
            const malicious = await MaliciousContract.deploy(await vault.getAddress());
            
            // Authorize the malicious contract to bypass onlyAuthorizedOrPublic, so we can test allowance check
            await vault.connect(owner).setAuthorizedCaller(await malicious.getAddress(), true);
            
            // Malicious contract cannot redeem without allowance (uses allowance check after authorization check)
            await expect(
                malicious.attemptRedeem(shares, await malicious.getAddress(), user.address)
            ).to.be.revertedWith("BolarityVault: Insufficient allowance");
        });
        
        it("Should protect crystallizeFees function", async function() {
            // Deploy malicious contract
            const MaliciousContract = await ethers.getContractFactory("MaliciousContract");
            const malicious = await MaliciousContract.deploy(await vault.getAddress());
            
            // Malicious contract should not be able to crystallize fees
            await expect(
                malicious.attemptCrystallizeFees()
            ).to.be.revertedWith("BolarityVault: Unauthorized");
        });
        
        it("Should allow removing authorization", async function() {
            // Authorize a caller
            await vault.connect(owner).setAuthorizedCaller(authorizedCaller.address, true);
            
            await mockToken.mint(authorizedCaller.address, ethers.parseUnits("1000", 6));
            await mockToken.connect(authorizedCaller).approve(await vault.getAddress(), ethers.MaxUint256);
            
            // Should work when authorized
            await vault.connect(authorizedCaller).deposit(ethers.parseUnits("100", 6), authorizedCaller.address);
            
            // Remove authorization
            await vault.connect(owner).setAuthorizedCaller(authorizedCaller.address, false);
            
            // Deploy a contract that will use authorizedCaller as sender
            const ProxyContract = await ethers.getContractFactory("ProxyContract");
            const proxy = await ProxyContract.connect(authorizedCaller).deploy(await vault.getAddress());
            
            // Should fail after authorization removed (when called from contract)
            await expect(
                proxy.connect(authorizedCaller).callDeposit(await mockToken.getAddress(), ethers.parseUnits("100", 6))
            ).to.be.reverted; // Just check that it reverts, not the specific message
        });
        
        it("Only owner can manage authorized callers", async function() {
            // Non-owner should not be able to authorize callers
            await expect(
                vault.connect(user).setAuthorizedCaller(unauthorizedCaller.address, true)
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        });
    });
    
    describe("Complex Authorization Scenarios", function() {
        it("Should handle fee collector correctly", async function() {
            // Set performance fee
            await vault.connect(owner).setPerfFeeBps(1000); // 10% fee
            
            // Authorize user for deposit
            await vault.connect(owner).setAuthorizedCaller(user.address, true);
            
            // First deposit
            await vault.connect(user).deposit(ethers.parseUnits("1000", 6), user.address);
            
            // Simulate some gains (mock strategy return)
            await mockToken.mint(await vault.getAddress(), ethers.parseUnits("100", 6));
            
            // Fee collector should be able to trigger crystallization
            // Since fee collector is owner in this case, it should work
            await expect(vault.connect(owner).crystallizeFees()).to.not.be.reverted;
            
            // Check fee shares were minted
            const feeCollectorShares = await vault.balanceOf(owner.address);
            expect(feeCollectorShares).to.be.gt(0);
        });
        
        it("Should maintain backward compatibility for direct users", async function() {
            // Authorize the user first for direct access
            await vault.connect(owner).setAuthorizedCaller(user.address, true);
            
            // Test all functions with direct user calls
            const amount = ethers.parseUnits("100", 6);
            
            // Deposit
            await expect(vault.connect(user).deposit(amount, user.address)).to.not.be.reverted;
            
            // Get shares
            const shares = await vault.balanceOf(user.address);
            expect(shares).to.be.gt(0);
            
            // Withdraw half
            await expect(vault.connect(user).withdraw(amount / 2n, user.address, user.address)).to.not.be.reverted;
            
            // Redeem remaining
            const remainingShares = await vault.balanceOf(user.address);
            await expect(vault.connect(user).redeem(remainingShares, user.address, user.address)).to.not.be.reverted;
            
            // Final balance should be 0
            expect(await vault.balanceOf(user.address)).to.equal(0);
        });
    });
});

// Mock contracts for testing
const MaliciousContractCode = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function mint(uint256 shares, address receiver) external returns (uint256 assets);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function crystallizeFees() external;
}

contract MaliciousContract {
    address public vault;
    
    constructor(address _vault) {
        vault = _vault;
    }
    
    function attemptDeposit(address token, uint256 amount) external returns (uint256) {
        IERC20(token).approve(vault, amount);
        return IVault(vault).deposit(amount, address(this));
    }
    
    function attemptWithdraw(uint256 amount, address receiver, address owner) external returns (uint256) {
        return IVault(vault).withdraw(amount, receiver, owner);
    }
    
    function attemptMint(address token, uint256 shares) external returns (uint256) {
        IERC20(token).approve(vault, type(uint256).max);
        return IVault(vault).mint(shares, address(this));
    }
    
    function attemptRedeem(uint256 shares, address receiver, address owner) external returns (uint256) {
        return IVault(vault).redeem(shares, receiver, owner);
    }
    
    function attemptCrystallizeFees() external {
        IVault(vault).crystallizeFees();
    }
}
`;

const ProxyContractCode = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
}

contract ProxyContract {
    address public vault;
    
    constructor(address _vault) {
        vault = _vault;
    }
    
    function callDeposit(address token, uint256 amount) external returns (uint256) {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        IERC20(token).approve(vault, amount);
        return IVault(vault).deposit(amount, msg.sender);
    }
}
`;

const MockRouterCode = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockRouter {
    // Simple mock router for testing
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool success, bytes memory result) = target.call(data);
        require(success, "MockRouter: call failed");
        return result;
    }
}
`;