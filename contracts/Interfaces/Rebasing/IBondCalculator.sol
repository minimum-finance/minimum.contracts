// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

/*
 * @dev Interface for BondCalculator contracts used with rebasing tokens.
 * @author minimum.finance
 */
interface IBondCalculator {
    function markdown(address pair) external view returns (uint256);
}
