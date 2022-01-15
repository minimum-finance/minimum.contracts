// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

import "../../Interfaces/Compound/ICErc20.sol";
import "../../Interfaces/Compound/IComptroller.sol";

import "../Common/FeeManager.sol";
import "../Common/StratManager.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/**
 * @dev Scream lending strategy, leverages and auto-compounds yield.
 */
contract StrategyScream is StratManager, FeeManager {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address public constant comptroller =
        0x260E596DAbE3AFc463e75B6CC05d8c46aCAcFB09;

    // Tokens used
    address public native;
    address public output;
    address public want;
    address public screamToken;

    address[] public outputToNativeRoute;
    address[] public outputToWantRoute;
    address[] public markets;

    uint256 public borrowDepth;
    uint256 public borrowRate;
    uint256 public borrowRateMax;
    uint256 public constant BORROW_DEPTH_MAX = 10;

    /**
     * @dev reserved {want}, required to deleverage
     */
    uint256 public reserves;

    /**
     * @dev The amount of {want} that has been deposited by
     * users and is currently working in scream
     */
    uint256 public balanceOfPool;

    /**
     * @dev Events emitted:
     * {Deposit}            - Emitted when funds are deposited into the strategy
     * {Withdraw}           - Emitted when funds are withdrawn from the strategy
     */
    event Deposit(uint256 tvl);
    event Withdraw(uint256 tvl);

    constructor(
        address _vault,
        uint256 _borrowDepth,
        uint256 _borrowRate,
        uint256 _borrowRateMax,
        uint256 _minLeverage,
        address[] memory _outputToNativeRoute,
        address[] memory _outputToWantRoute,
        address[] memory _markets,
        address _unirouter,
        address _keeper,
        address _serviceFeeRecipient
    )
        public
        StratManager(
            _keeper,
            _unirouter,
            _vault,
            _serviceFeeRecipient,
            _minLeverage
        )
    {
        borrowDepth = _borrowDepth;
        borrowRate = _borrowRate;
        borrowRateMax = _borrowRateMax;

        markets = _markets;
        screamToken = markets[0]; // Scream version of {want}
        want = ICErc20(screamToken).underlying();

        output = _outputToNativeRoute[0]; // This strategy accumulates interest in {output}
        native = _outputToNativeRoute[_outputToNativeRoute.length - 1];
        outputToNativeRoute = _outputToNativeRoute;

        require(
            _outputToWantRoute[_outputToWantRoute.length - 1] == want,
            "outputToNativeRoute[last] != want"
        );
        outputToWantRoute = _outputToWantRoute;

        _giveAllowances();

        IComptroller(comptroller).enterMarkets(_markets);
    }

    function _giveAllowances() internal {
        IERC20(want).safeApprove(screamToken, type(uint256).max);
        IERC20(output).safeApprove(unirouter, type(uint256).max);
    }

    function outputToNative() external view returns (address[] memory) {
        return outputToNativeRoute;
    }

    function outputToWant() external view returns (address[] memory) {
        return outputToWantRoute;
    }

    /**
     * @return how much {want} the contract holds without reserves
     */
    function availableWant() public view returns (uint256) {
        return balanceOfWant().sub(reserves);
    }

    /**
     * @return how much {want} the contract holds, including reserves
     */
    function balanceOfWant() public view returns (uint256) {
        return IERC20(want).balanceOf(address(this));
    }

    /*
     * @dev TVL of this strategy in want
     */
    function totalBalance() public view returns (uint256) {
        return balanceOfWant().add(balanceOfPool);
    }

    /**
     * @dev leverages and puts the available funds in the strategy to work
     * @notice emits Deposit(TVL)
     */
    function deposit() public whenNotPaused {
        uint256 wantBal = availableWant();

        if (wantBal > 0) {
            _leverage(wantBal);
            emit Deposit(totalBalance());
        }
    }

    /**
     * @dev Leverages deposited funds by repeatedly supplying and borrowing {want} at the {}.
     */
    function _leverage(uint256 _amount) internal {
        if (_amount < minDeposit) {
            return;
        }

        for (uint256 i = 0; i < borrowDepth; i += 1) {
            ICErc20(screamToken).mint(_amount);
            _amount = _amount.mul(borrowRate).div(100);
            ICErc20(screamToken).borrow(_amount);
        }

        reserves = reserves.add(_amount);

        updateBalance();
    }

    /*
     * @dev Updates the balance of user deposited {want} in scream.
     */
    function updateBalance() public {
        // Balance of {want} that has been turned into screamToken
        uint256 supplyBal = ICErc20(screamToken).balanceOfUnderlying(
            address(this)
        );
        // Balance of {want} that has been borrowed
        uint256 borrowBal = ICErc20(screamToken).borrowBalanceCurrent(
            address(this)
        );
        // The amount of {want} that has been deposited by users and used in scream
        balanceOfPool = supplyBal.sub(borrowBal);
    }

    // pause deposits and withdraws
    function pause() public onlyManager {
        _pause();
        _removeAllowances(); // dont allow spenders to spend
    }

    // Dont spend our monay!
    function _removeAllowances() internal {
        IERC20(want).safeApprove(screamToken, 0);
        IERC20(output).safeApprove(unirouter, 0);
    }

    // Resume the games!
    function unpause() external onlyManager {
        _unpause();
        _giveAllowances();
        deposit();
    }

    // Get out of borrowing position and pause functionality
    function panic() external onlyManager {
        _deleverage();
        pause();
    }

    // Gets out of borrow position to get initial deposit in contract
    function _deleverage() internal {
        // how much we borrowed
        uint256 borrowBalance = ICErc20(screamToken).borrowBalanceCurrent(
            address(this)
        );
        // how much we have of underlying
        uint256 wantBalance = IERC20(want).balanceOf(address(this));

        while (borrowBalance > wantBalance) {
            // Repay as much want as you can
            ICErc20(screamToken).repayBorrow(wantBalance);
            // Check how much want have borrowed now
            borrowBalance = ICErc20(screamToken).borrowBalanceCurrent(
                address(this)
            );

            // Amount of scream token to keep
            uint256 targetSupply = borrowBalance.mul(100).div(borrowRate);

            // How much want is your scream token worth?
            uint256 supplyBalance = ICErc20(screamToken).balanceOfUnderlying(
                address(this)
            );
            ICErc20(screamToken).redeemUnderlying(
                supplyBalance.sub(targetSupply)
            );

            wantBalance = IERC20(want).balanceOf(address(this));
        }

        ICErc20(screamToken).repayBorrow(type(uint256).max);
        uint256 numRedeem = ICErc20(screamToken).balanceOf(address(this));
        ICErc20(screamToken).redeem(numRedeem);

        reserves = 0; // because nothing leveraged, no need for reserves

        updateBalance();
    }

    /*
     * @dev Withdraws funds from scream and sends them back to the vault.
     * Deleverages entirely and then re-leverages to maintain proper reserves.
     * @param _amount The amount of {want} to withdraw.
     * @notice emits Withdraw(TVL)
     */
    function withdraw(uint256 _amount) external {
        require(msg.sender == vault, "!Vault");

        uint256 wantBal = availableWant();

        if (_amount > wantBal) {
            _deleverage();
            wantBal = IERC20(want).balanceOf(address(this));
        }

        if (wantBal > _amount) {
            wantBal = _amount;
        }

        // @notice we may want to not take withdraw fees when paused in the future.
        if (tx.origin != owner() && tx.origin != keeper) {
            // redistribute withdrawal fees amongst users to deter yield stealing
            uint256 withdrawalFeeAmount = wantBal.mul(withdrawalFee).div(
                WITHDRAWAL_FEE_DIVISOR
            );
            wantBal = wantBal.sub(withdrawalFeeAmount);
        }

        IERC20(want).safeTransfer(vault, wantBal);
        emit Withdraw(totalBalance());

        if (!paused()) {
            _leverage(availableWant());
        }
    }
}
