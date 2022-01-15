// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Custom interface for IERC20 tokens with a decimal amount.
 * Necessary for rebase tokens, as they often have 9 decimals rather than 18.
 * @author minimum.finance
 */
interface IDERC20 is IERC20 {
    /**
     * @dev Returns the number of decimals in this rebaseToken
     */
    function decimals() external view returns (uint8);
}
