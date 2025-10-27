// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./BolarityVault.sol";
import "./interfaces/IRegistry.sol";

contract VaultFactory is Ownable {
    using Clones for address;

    address public immutable vaultImplementation;
    IRegistry public immutable registry;
    address public immutable router; // Router is set once in constructor

    event VaultDeployed(
        address indexed asset,
        bytes32 indexed market,
        address indexed vault,
        address strategy,
        string name,
        string symbol
    );

    constructor(address _registry, address _router) Ownable(msg.sender) {
        require(_registry != address(0), "VaultFactory: Invalid registry");
        require(_router != address(0), "VaultFactory: Invalid router");
        registry = IRegistry(_registry);
        router = _router;
        
        vaultImplementation = address(
            new BolarityVault(
                IERC20(address(0)), // Use address(0) for implementation
                "Implementation",
                "IMPL",
                address(1),         // Use address(1) as placeholder for strategy
                address(1),         // Use address(1) as placeholder for router
                address(1),         // Use address(1) as placeholder for feeCollector
                0
            )
        );
    }

    function createVault(
        address asset,
        bytes32 market,
        address strategy,
        address feeCollector,
        uint16 perfFeeBps,
        string memory name,
        string memory symbol
    ) external onlyOwner returns (address vault) {
        require(asset != address(0), "VaultFactory: Invalid asset");
        require(market != bytes32(0), "VaultFactory: Invalid market");
        require(strategy != address(0), "VaultFactory: Invalid strategy");
        require(feeCollector != address(0), "VaultFactory: Invalid fee collector");
        
        bytes32 salt = keccak256(abi.encodePacked(asset, market));
        vault = vaultImplementation.cloneDeterministic(salt);
        
        BolarityVault(vault).initialize(
            IERC20(asset),
            name,
            symbol,
            strategy,
            router,  // Pass the router address
            feeCollector,
            perfFeeBps
        );
        
        // Transfer ownership
        BolarityVault(vault).transferOwnership(owner());
        
        registry.registerVault(asset, market, vault);
        
        emit VaultDeployed(asset, market, vault, strategy, name, symbol);
    }

    function computeVaultAddress(address asset, bytes32 market) external view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(asset, market));
        return vaultImplementation.predictDeterministicAddress(salt, address(this));
    }
    
    function recoverRegistryOwnership() external onlyOwner {
        Ownable(address(registry)).transferOwnership(msg.sender);
    }
}