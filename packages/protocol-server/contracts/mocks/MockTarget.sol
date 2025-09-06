// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockTarget {
    uint256 public counter;
    uint256 public lastValue;
    bool public flag;

    event DidSomething(address caller, uint256 newCounter);

    function increment() external {
        counter += 1;
        emit DidSomething(msg.sender, counter);
    }

    function setValue(uint256 v) external {
        lastValue = v;
    }

    function toggle() external {
        flag = !flag;
    }

    function willRevert() external pure {
        revert("MockTarget:revert");
    }
}
