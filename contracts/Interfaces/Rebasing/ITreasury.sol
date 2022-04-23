// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

/*
 * @dev Interface for OlympusTreasury contracts used with rebasing tokens.
 * @author minimum.finance
 */
interface ITreasury {
    function deposit(
        uint256 _amount,
        address _token,
        uint256 _profit
    ) external returns (bool);

    function valueOf(address _token, uint256 _amount)
        external
        view
        returns (uint256 value_);
}
