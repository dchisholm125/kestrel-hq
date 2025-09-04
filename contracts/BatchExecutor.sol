// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BatchExecutor
 * @notice Executes a list of calls (target, value, data) sequentially and atomically.
 *         If any call reverts, the entire batch reverts.
 */
contract BatchExecutor {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    event BatchExecuted(uint256 calls, uint256 gasUsed);

    /**
     * @dev Execute a set of calls sequentially. Reverts on first failure.
     * @param calls Array of Call structs.
     */
    function executeBatch(Call[] calldata calls) external payable returns (bytes[] memory results) {
        uint256 startGas = gasleft();
        uint256 length = calls.length;
        results = new bytes[](length);
        for (uint256 i = 0; i < length; i++) {
            Call calldata c = calls[i];
            (bool ok, bytes memory ret) = c.target.call{value: c.value}(c.data);
            if (!ok) {
                // Bubble up revert data if present
                if (ret.length > 0) {
                    assembly {
                        revert(add(ret, 0x20), mload(ret))
                    }
                } else {
                    revert("BatchExecutor:call_failed");
                }
            }
            results[i] = ret;
        }
        emit BatchExecuted(length, startGas - gasleft());
    }
}
