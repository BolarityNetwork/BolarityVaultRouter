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