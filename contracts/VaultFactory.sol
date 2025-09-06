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
    address public router;

    event VaultDeployed(
        address indexed asset,
        bytes32 indexed market,
        address indexed vault,
        address strategy,
        string name,
        string symbol
    );
    
    event RouterUpdated(address indexed newRouter);

    constructor(address _registry) Ownable(msg.sender) {
        require(_registry != address(0), "VaultFactory: Invalid registry");
        registry = IRegistry(_registry);
        
        vaultImplementation = address(
            new BolarityVault(
                IERC20(address(1)),
                "Implementation",
                "IMPL",
                address(1),
                address(1),
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
            feeCollector,
            perfFeeBps
        );
        
        // Set router if configured (before transferring ownership)
        if (router != address(0)) {
            BolarityVault(vault).setRouter(router);
        }
        
        BolarityVault(vault).transferOwnership(owner());
        
        registry.registerVault(asset, market, vault);
        
        emit VaultDeployed(asset, market, vault, strategy, name, symbol);
    }

    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "VaultFactory: Invalid router");
        router = _router;
        emit RouterUpdated(_router);
    }
    
    function computeVaultAddress(address asset, bytes32 market) external view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(asset, market));
        return vaultImplementation.predictDeterministicAddress(salt, address(this));
    }
    
    function recoverRegistryOwnership() external onlyOwner {
        Ownable(address(registry)).transferOwnership(msg.sender);
    }
}