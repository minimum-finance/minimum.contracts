// SPDX-License-Identifier: MIT

pragma solidity >=0.6.12;

import "../../Interfaces/Rebasing/IRebaseStaker.sol";
import "../../Interfaces/Rebasing/IStakingManager.sol";
import "../../Interfaces/Uniswap/IUniswapRouterEth.sol";
import "../../Interfaces/Uniswap/IUniswapV2Pair.sol";
import "../../Interfaces/Rebasing/IBondDepository.sol";

import "../Common/FeeManager.sol";
import "../Common/StratManager.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/Math.sol";

/*
 __    __     __     __   __      ______   __
/\ "-./  \   /\ \   /\ "-.\ \    /\  ___\ /\ \
\ \ \-./\ \  \ \ \  \ \ \-.  \   \ \  __\ \ \ \
 \ \_\ \ \_\  \ \_\  \ \_\\"\_\   \ \_\    \ \_\
  \/_/  \/_/   \/_/   \/_/ \/_/    \/_/     \/_/
*/

/**
 * @dev Rebasing DAO yield optimizer for spartacus.finance
 * @author minimum.finance
 */
contract StrategySpartacus is StratManager, FeeManager {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /**
     * @dev Super secret Discord link
     */
    string public discordLink;

    /**
     * @dev Tokens:
     * {rebaseToken}        - The rebase protocol's token
     * {stakedRebaseToken}  - The staked version of {rebaseToken}
     */
    address public constant rebaseToken =
        0x5602df4A94eB6C680190ACCFA2A475621E0ddBdc; // SPA
    address public constant stakedRebaseToken =
        0x8e2549225E21B1Da105563D419d5689b80343E01; // sSPA

    /**
     * @dev Bonds:
     * {bonds}              - Exhaustive list of the strategy's accepted bonds
     * {indexOfBond}        - Index of each bond in {bonds}
     * {currentBond}        - The current bond being used (0 address if not bonding)
     */
    address[] public bonds;
    mapping(address => uint256) indexOfBond; // 1-based to avoid default value
    address public currentBond;
    uint256 public rebaseBonded;

    /**
     * @dev RebasingDAO Contracts:
     * {rebaseStaker}       - The rebase StakingHelper contract
     * {stakeManager}       - The rebase OlympusStaking contract
     */
    address public rebaseStaker;
    address public stakeManager;

    struct Claim {
        bool fullyVested;
        uint256 amount;
        uint256 index;
    }

    /**
     * @dev Withdrawal:
     * {claimOfReserves}     - how much a user owns of the reserves in {rebaseToken}
     * {reserveUsers}        - list of users who requested a withdraw
     * {reserves}            - {rebaseToken} reserved for withdrawal use so that it cannot be bonded
     * {claimers}            - list of users who can claim -- for forcePayoutChunk
     */
    mapping(address => Claim) public claimOfReserves;
    address[] public reserveUsers;
    uint256 public reserves;
    address[] public claimers;

    // Utilities
    IUniswapV2Pair public constant rebaseTokenDaiPair =
        IUniswapV2Pair(0xFa5a5F0bC990Be1D095C5385Fff6516F6e03c0a7); // Used to get price of rebaseToken in USD

    /**
     * @dev Events:
     * Deposit          - Emitted when funds are deposited into the strategy
     * Reserve          - Emitted when funds are reserved from the strategy
     * Stake            - Emitted when {rebaseToken} is staked
     * Unstake          - Emitted when {rebaseToken} is unstaked
     * Bond             - Emitted when {rebaseToken} is bonded
     * BondAdded        - Emitted when a bondDepository is added to {bonds}
     * BondRemoved      - Emitted when a bondDepository is removed from {bonds}
     * Redeem           - Emitted when the keeper redeems a bond
     * RedeemFinal      - Emitted when the keeper executes the final redemption for a bond
     *
     * @notice trl - Total Rebasing Locked
     */
    event Deposit(uint256 trl);
    event Reserve(uint256 trl, uint256 payout);
    event Stake(uint256 totalStaked, uint256 totalBonded);
    event Unstake(
        uint256 totalStaked,
        uint256 totalUnstaked,
        uint256 totalBonded
    );
    event Bond(
        uint256 totalStaked,
        uint256 totalUnstaked,
        uint256 totalBonded,
        address bondDepository
    );
    event BondAdded(address[] bonds);
    event BondRemoved(address[] bonds);
    event Redeem(uint256 trl, uint256 rebaseRedeemed);
    event RedeemFinal(uint256 trl, uint256 rebaseRedeemed);

    constructor(
        address _vault,
        address _rebaseStaker,
        address _stakeManager,
        address _keeper,
        address _unirouter,
        address _serviceFeeRecipient,
        uint256 _minDeposit,
        string memory _discordLink
    )
        public
        StratManager(
            _keeper,
            _unirouter,
            _vault,
            _serviceFeeRecipient,
            _minDeposit
        )
    {
        require(
            _rebaseStaker != address(0) && _stakeManager != address(0),
            "!0 Address"
        );

        rebaseStaker = _rebaseStaker;
        stakeManager = _stakeManager;
        discordLink = _discordLink;
    }

    /* ======== VIEW FUNCTIONS ======== */

    /**
     * @dev Interface method for interoperability with vault
     */
    function want() external pure returns (address) {
        return rebaseToken;
    }

    /**
     * @dev Total staked and unstaked {rebaseToken} locked
     */
    function totalRebasing() public view returns (uint256) {
        return unstakedRebasing().add(stakedRebasing());
    }

    /**
     * @dev Total unstaked {rebaseToken} locked
     */
    function unstakedRebasing() public view returns (uint256) {
        return IERC20(rebaseToken).balanceOf(address(this));
    }

    /**
     * @dev Total staked {rebaseToken} locked
     */
    function stakedRebasing() public view returns (uint256) {
        return IERC20(stakedRebaseToken).balanceOf(address(this));
    }

    /**
     * @dev Total available staked and unstaked {rebaseToken} locked
     */
    function availableRebaseToken() public view returns (uint256) {
        return totalRebasing().sub(reserves);
    }

    /**
     * @dev Total staked, unstaked, and bonded {rebaseToken} locked
     */
    function totalBalance() public view returns (uint256) {
        uint256 rebaseAmount = totalRebasing();

        return
            reserves < rebaseAmount.add(rebaseBonded)
                ? rebaseAmount.add(rebaseBonded).sub(reserves)
                : 0;
    }

    /**
     * @dev Whether or not the strategy is currently bonding
     */
    function isBonding() public view returns (bool) {
        return currentBond != address(0);
    }

    /**
     * @dev Number of validated bonds
     */
    function numBonds() external view returns (uint256) {
        return bonds.length;
    }

    /**
     * @dev Check whether a bond is validated
     * @param _bondDepository BondDepository address
     */
    function isBondValid(address _bondDepository) public view returns (bool) {
        return indexOfBond[_bondDepository] != 0;
    }

    /* ======== USER FUNCTIONS ======== */

    /**
     * @dev Deposit available {rebaseToken} into Spartacus
     * @notice Emits Deposit(trl)
     */
    function deposit() external whenNotPaused {
        _stake();

        emit Deposit(totalBalance());
    }

    /**
     * @dev Reserves funds from staked {rebaseToken} to be paid out when bonding is over
     * @param _amount The amount of {rebaseToken} to reserve
     * @param _claimer The address whose funds need to be reserved
     * @notice Emits Reserve()
     * @notice If not currently bonding, sends funds immediately
     */
    function reserve(uint256 _amount, address _claimer) external {
        require(msg.sender == vault, "!Vault");

        _amount = _amount.sub(
            _amount.mul(withdrawalFee).div(WITHDRAWAL_FEE_DIVISOR)
        );

        if (isBonding()) {
            Claim memory previousClaim = claimOfReserves[_claimer];
            if (previousClaim.fullyVested || previousClaim.amount == 0)
                reserveUsers.push(_claimer);
            if (previousClaim.index == 0) claimers.push(_claimer);

            claimOfReserves[_claimer] = Claim({
                amount: previousClaim.amount.add(_amount),
                fullyVested: false, // Notice that users should claim before reserving again
                index: previousClaim.index == 0
                    ? claimers.length
                    : previousClaim.index
            });

            reserves = reserves.add(_amount);
        } else {
            if (_amount > totalRebasing()) _amount = totalRebasing();

            _pay(_claimer, _amount);
        }

        emit Reserve(totalBalance(), _amount);
    }

    /**
     * @dev Claim vested out position
     * @param _claimer The address of the claimer
     */
    function claim(address _claimer) external returns (uint256) {
        require(msg.sender == vault, "!Vault");
        require(claimOfReserves[_claimer].fullyVested, "!fullyVested");
        return _claim(_claimer);
    }

    /* ======== BOND FUNCTIONS ======== */

    /**
     * @dev Add a bond to the list of valid bonds
     * @param _bondDepository Bond to validate
     */
    function addBond(address _bondDepository) external onlyOwner {
        require(!isBondValid(_bondDepository), "!invalid bond");
        bonds.push(_bondDepository);
        indexOfBond[_bondDepository] = bonds.length; // 1 based indexing

        emit BondAdded(bonds);
    }

    /**
     * @dev Remove a bond from the list of valid bonds
     * @param _bondDepository Bond to invalidate
     */
    function removeBond(address _bondDepository) external onlyOwner {
        uint256 index = indexOfBond[_bondDepository]; // Starting from 1
        require(index <= bonds.length && index > 0, "!valid bond");

        if (bonds.length > 1) {
            bonds[index - 1] = bonds[bonds.length - 1]; // Replace with last element
        }
        // Remove last element as we have it saved in deleted slot
        bonds.pop();
        delete indexOfBond[_bondDepository];

        emit BondRemoved(bonds);
    }

    /**
     * @dev Move all sSPA from staking to bonding funds in a single token bond
     * @param bondDepository address of BondDepository to use
     * @param rebaseToPrincipleRoute the route from {rebaseToken} to bond principle
     */
    function stakeToBondSingleAll(
        IBondDepository bondDepository,
        address[] calldata rebaseToPrincipleRoute
    ) external {
        stakeToBondSingle(
            availableRebaseToken(),
            bondDepository,
            rebaseToPrincipleRoute
        );
    }

    /**
     * @dev Move all sSPA from staking to bonding funds in an LP token bond
     * @param bondDepository address of BondDepository to use
     * @param rebaseToToken0Route route from {rebaseToken} to token0 in the LP
     * @param rebaseToToken1Route route from {rebaseToken} to token1 in the LP
     */
    function stakeToBondLPAll(
        IBondDepository bondDepository,
        address[] calldata rebaseToToken0Route,
        address[] calldata rebaseToToken1Route
    ) external {
        stakeToBondLP(
            availableRebaseToken(),
            bondDepository,
            rebaseToToken0Route,
            rebaseToToken1Route
        );
    }

    /**
     * @dev Move from staking to bonding funds in a single token bond
     * @param _amount of sSPA to withdraw and bond
     * @param bondDepository BondDepository of the bond to use
     * @param rebaseToPrincipleRoute The route to take from {rebaseToken} to the bond principle token
     */
    function stakeToBondSingle(
        uint256 _amount,
        IBondDepository bondDepository,
        address[] calldata rebaseToPrincipleRoute
    ) public onlyManager {
        require(!isBonding(), "Already bonding!");
        require(_amount > 0, "amount <= 0!");
        require(isBondValid(address(bondDepository)), "Unapproved bond!");
        require(
            rebaseToPrincipleRoute.length > 0 &&
                rebaseToPrincipleRoute[0] == rebaseToken,
            "Route must start with rebaseToken!"
        );
        require(
            rebaseToPrincipleRoute[rebaseToPrincipleRoute.length - 1] ==
                bondDepository.principle(),
            "Route must end with bond principle!"
        );
        require(bondIsPositive(bondDepository), "!bondIsPositive");
        currentBond = address(bondDepository);

        uint256 maxBondableSPA = maxBondSize(bondDepository);

        if (_amount > availableRebaseToken()) _amount = availableRebaseToken();
        if (_amount > maxBondableSPA) _amount = maxBondableSPA;

        rebaseBonded = _amount;
        uint256 unstaked = unstakedRebasing();
        if (_amount > unstaked) _unstake(_amount.sub(unstaked)); // gets SPA to this strategy

        _bondSingleToken(_amount, bondDepository, rebaseToPrincipleRoute);
    }

    /**
     * @dev Move from staking to bonding funds in an LP token bond
     * @param _amount of sSPA to withdraw and bond
     * @param bondDepository BondDepository of the bond to use
     * @param rebaseToToken0Route route from {rebaseToken} to token0 in the LP
     * @param rebaseToToken1Route route from {rebaseToken} to token1 in the LP
     */
    function stakeToBondLP(
        uint256 _amount,
        IBondDepository bondDepository,
        address[] calldata rebaseToToken0Route,
        address[] calldata rebaseToToken1Route
    ) public onlyManager {
        require(!isBonding(), "Already bonding!");
        require(_amount > 0, "amount <= 0!");
        require(isBondValid(address(bondDepository)), "Unapproved bond!");
        require(
            rebaseToToken0Route.length > 0 &&
                rebaseToToken1Route.length > 0 &&
                rebaseToToken0Route[0] == rebaseToken &&
                rebaseToToken1Route[0] == rebaseToken,
            "Routes must start with {rebaseToken}!"
        );
        require(
            rebaseToToken0Route[rebaseToToken0Route.length - 1] ==
                IUniswapV2Pair(bondDepository.principle()).token0() &&
                rebaseToToken1Route[rebaseToToken1Route.length - 1] ==
                IUniswapV2Pair(bondDepository.principle()).token1(),
            "Routes must end with their respective tokens!"
        );
        require(bondIsPositive(bondDepository), "!bondIsPositive");
        currentBond = address(bondDepository);

        uint256 maxBondableSPA = maxBondSize(bondDepository);

        if (_amount > availableRebaseToken()) _amount = availableRebaseToken();
        if (_amount > maxBondableSPA) _amount = maxBondableSPA;

        uint256 unstaked = unstakedRebasing();
        if (_amount > unstaked) _unstake(_amount.sub(unstaked)); // gets SPA to this strategy

        _bondLPToken(
            _amount,
            bondDepository,
            rebaseToToken0Route,
            rebaseToToken1Route
        );
    }

    /**
     * @dev Redeem and stake rewards from a bond
     */
    function redeemAndStake() external onlyManager {
        _redeem();
    }

    /**
     * @dev Force push payout to claimer
     * @param _claimer The address of the claimer to payout
     */
    function forcePayout(address _claimer)
        external
        onlyOwner
        returns (uint256)
    {
        require(claimOfReserves[_claimer].fullyVested, "!fullyVested");
        return _claim(_claimer);
    }

    /**
     * @dev Force push payout to all claimers (in chunks to avoid gas limit)
     * @notice Necessary to be able to upgrade the strategy
     * @return Whether or not all claimers are paid out
     */
    function forcePayoutChunk() external onlyOwner returns (bool) {
        require(!isBonding(), "Cannot force payout chunk during bond!");
        uint256 chunkSize = Math.min(50, claimers.length);
        uint256 totalRebaseToken = totalRebasing();
        uint256 tempReserves = reserves;

        for (uint256 i = 0; i < chunkSize; i++) {
            address _claimer = claimers[i];
            Claim memory userClaim = claimOfReserves[_claimer];

            delete claimOfReserves[_claimer];

            // If for some reason we can't fulfill reserves, pay as much as we can to everyone
            uint256 _amount = reserves > totalRebaseToken
                ? userClaim.amount.mul(totalRebaseToken).div(reserves)
                : userClaim.amount;

            tempReserves = tempReserves.sub(_amount);

            _pay(_claimer, _amount);
        }

        for (uint256 i = 0; i < chunkSize; i++) {
            if (claimers.length > 1)
                claimers[i] = claimers[claimers.length - 1];
            claimers.pop();
        }

        reserves = claimers.length == 0 ? 0 : tempReserves; // Ensure no dust left in reserves

        return claimers.length == 0;
    }

    /* ======== INTERNAL HELPER FUNCTIONS ======== */

    /**
     * @dev Claim a user's vested out position
     * @param _claimer The address of the claimer
     */
    function _claim(address _claimer) internal returns (uint256) {
        Claim memory userClaim = claimOfReserves[_claimer];

        delete claimOfReserves[_claimer];

        // If for some reason we can't fulfill reserves, pay as much as we can to everyone
        uint256 _amount = reserves > totalRebasing()
            ? userClaim.amount.mul(totalRebasing()).div(reserves)
            : userClaim.amount;

        reserves = reserves.sub(_amount);

        if (claimers.length > 1)
            claimers[userClaim.index - 1] = claimers[claimers.length - 1];
        claimers.pop();

        _pay(_claimer, _amount);

        return _amount;
    }

    /**
     * @dev Send {rebaseToken} to the claimer
     * @param _claimer The address to send {rebaseToken} to
     * @param _amount The amount of {rebaseToken} to send
     */
    function _pay(address _claimer, uint256 _amount) internal {
        if (_amount > unstakedRebasing())
            _unstake(_amount.sub(unstakedRebasing()));

        IERC20(rebaseToken).safeTransfer(_claimer, _amount);
    }

    /**
     * @dev Stake all of the strategy's {rebaseToken}
     */
    function _stake() internal {
        uint256 _amount = unstakedRebasing();
        if (_amount < minDeposit) return;

        IERC20(rebaseToken).safeIncreaseAllowance(rebaseStaker, _amount);
        IRebaseStaker(rebaseStaker).stake(_amount);

        emit Stake(stakedRebasing(), rebaseBonded);
    }

    /**
     * @dev Unstake {stakedRebasingToken}
     * @param _amount of {stakedRebasingToken} to unstake
     * @notice if _amount exceeds the strategy's balance of
     * {stakedRebasingToken}, unstake all {stakedRebasingToken}
     */
    function _unstake(uint256 _amount) internal {
        if (_amount <= 0) return;
        if (_amount > stakedRebasing()) _amount = stakedRebasing();

        IERC20(stakedRebaseToken).safeIncreaseAllowance(stakeManager, _amount);
        IStakingManager(stakeManager).unstake(_amount, true);

        emit Unstake(stakedRebasing(), unstakedRebasing(), rebaseBonded);
    }

    /**
     * @dev Swap {rebaseToken} for {_outputToken}
     * @param _rebaseAmount The amount of {rebaseToken} to swap for {_outputToken}
     * @param rebaseToTokenRoute Route to swap from {rebaseToken} to the output
     * @notice If {_rebaseAmount} is greater than the available {rebaseToken}
     *         swaps all available {rebaseToken}
     * @notice Make sure to unstake {stakedRebaseToken} before calling!
     */
    function _swapRebaseForToken(
        uint256 _rebaseAmount,
        address[] memory rebaseToTokenRoute
    ) internal {
        require(
            rebaseToTokenRoute[0] == rebaseToken,
            "Route must start with rebaseToken!"
        );
        if (rebaseToTokenRoute[rebaseToTokenRoute.length - 1] == rebaseToken)
            return;

        IUniswapRouterETH(unirouter).swapExactTokensForTokens(
            _rebaseAmount > unstakedRebasing()
                ? unstakedRebasing()
                : _rebaseAmount,
            0,
            rebaseToTokenRoute,
            address(this),
            now
        );
    }

    /**
     * @dev Swap for token0 and token1 and provide liquidity to receive LP tokens
     * @param _amount The amount of {rebaseToken} to use to provide liquidity
     * @param token0 The first token in the LP
     * @param token1 The second token in the LP
     * @param rebaseToToken0Route The route to swap from {rebaseToken} to token0
     * @param rebaseToToken1Route The route to swap from {rebaseToken} to token1
     * @notice Make sure to unstake the desired amount of {stakedRebaseToken} before calling!
     */
    function _provideLiquidity(
        uint256 _amount,
        address token0,
        address token1,
        address[] memory rebaseToToken0Route,
        address[] memory rebaseToToken1Route
    ) internal {
        uint256 token0Before = IERC20(token0).balanceOf(address(this));
        uint256 token1Before = IERC20(token1).balanceOf(address(this));

        IERC20(rebaseToken).safeIncreaseAllowance(unirouter, _amount);

        if (rebaseToToken0Route.length > 1)
            _swapRebaseForToken(_amount.div(2), rebaseToToken0Route);
        if (rebaseToToken1Route.length > 1)
            _swapRebaseForToken(_amount.div(2), rebaseToToken1Route);

        uint256 token0After = IERC20(token0).balanceOf(address(this));
        uint256 token1After = IERC20(token1).balanceOf(address(this));

        uint256 token0Amount = token0After > token0Before
            ? token0After.sub(token0Before)
            : token0Before.sub(token0After);

        uint256 token1Amount = token1After > token1Before
            ? token1After.sub(token1Before)
            : token1Before.sub(token1After);

        IERC20(token0).safeIncreaseAllowance(unirouter, token0Amount);
        IERC20(token1).safeIncreaseAllowance(unirouter, token1Amount);

        IUniswapRouterETH(unirouter).addLiquidity(
            token0,
            token1,
            token0Amount,
            token1Amount,
            0,
            0,
            address(this),
            now
        );
    }

    /**
     * @dev Deposit into single sided bond
     * @param _amount of SPA to swap to single token and bond
     * @param bondDepository BondDepository address
     * @param rebaseToPrincipleRoute The route to swap from {rebaseToken} to the bond principle token
     */
    function _bondSingleToken(
        uint256 _amount,
        IBondDepository bondDepository,
        address[] memory rebaseToPrincipleRoute
    ) internal {
        address bondToken = rebaseToPrincipleRoute[
            rebaseToPrincipleRoute.length - 1
        ];
        uint256 bondTokenBalanceBefore = IERC20(bondToken).balanceOf(
            address(this)
        );

        // Swap allowance
        IERC20(rebaseToken).safeIncreaseAllowance(unirouter, _amount);

        _swapRebaseForToken(_amount, rebaseToPrincipleRoute);

        uint256 bondTokenObtained = IERC20(bondToken)
            .balanceOf(address(this))
            .sub(bondTokenBalanceBefore);

        _bondTokens(bondDepository, bondTokenObtained, bondToken);
    }

    /**
     * @dev Deposit into LP bond
     * @param _amount of SPA to swap to LP token and bond
     * @param bondDepository BondDepository address
     * @param rebaseToToken0Route route from {rebaseToken} to token0 in the LP
     * @param rebaseToToken1Route route from {rebaseToken} to token1 in the LP
     */
    function _bondLPToken(
        uint256 _amount,
        IBondDepository bondDepository,
        address[] memory rebaseToToken0Route,
        address[] memory rebaseToToken1Route
    ) internal {
        address bondToken = bondDepository.principle();
        address token0 = rebaseToToken0Route[rebaseToToken0Route.length - 1];
        address token1 = rebaseToToken1Route[rebaseToToken1Route.length - 1];

        uint256 bondTokenBalanceBefore = IERC20(bondToken).balanceOf(
            address(this)
        );

        uint256 unstakedBefore = unstakedRebasing();

        _provideLiquidity(
            _amount,
            token0,
            token1,
            rebaseToToken0Route,
            rebaseToToken1Route
        );

        rebaseBonded = unstakedBefore.sub(unstakedRebasing());

        uint256 bondTokenObtained = IERC20(bondToken)
            .balanceOf(address(this))
            .sub(bondTokenBalanceBefore);

        _bondTokens(bondDepository, bondTokenObtained, bondToken);
    }

    /**
     * @dev Bond tokens into the bond depository
     * @param bondDepository bond depository to bond into
     * @param _amount amount of principle to bond
     */
    function _bondTokens(
        IBondDepository bondDepository,
        uint256 _amount,
        address bondToken
    ) internal {
        uint256 acceptedSlippage = 5; // 0.5%
        uint256 maxPremium = bondDepository
            .bondPrice()
            .mul(acceptedSlippage.add(1000))
            .div(1000);

        // Update BondDepository allowances
        IERC20(bondToken).safeIncreaseAllowance(
            address(bondDepository),
            _amount
        );

        // Bond principle tokens
        bondDepository.deposit(_amount, maxPremium, address(this));
        _stake();

        emit Bond(
            stakedRebasing(),
            unstakedRebasing(),
            rebaseBonded,
            address(bondDepository)
        );
    }

    /**
     * @dev Claim redeem rewards from a bond and payout reserves if the bond is over.
     * @notice Stakes redeem rewards
     */
    function _redeem() internal {
        uint256 percentVested = IBondDepository(currentBond).percentVestedFor(
            address(this)
        );

        uint256 rebaseAmountBefore = unstakedRebasing();
        IBondDepository(currentBond).redeem(address(this), false);
        uint256 rebaseRedeemed = unstakedRebasing().sub(rebaseAmountBefore);
        _stake();
        rebaseRedeemed = _chargeFees(rebaseRedeemed);
        if (rebaseBonded > rebaseRedeemed) rebaseBonded -= rebaseRedeemed;
        else rebaseBonded = 0;

        // If this is final redemption, remove currentBond and update claimOfReserves
        if (percentVested >= 10000) {
            currentBond = address(0);
            rebaseBonded = 0;

            for (uint256 i = 0; i < reserveUsers.length; i++) {
                claimOfReserves[reserveUsers[i]].fullyVested = true;
            }
            emit RedeemFinal(totalRebasing(), rebaseRedeemed);
            delete reserveUsers;
        } else emit Redeem(totalBalance(), rebaseRedeemed);
    }

    /**
     * @dev Charge performance fees
     * @param _amount to fee
     */
    function _chargeFees(uint256 _amount) internal returns (uint256) {
        uint256 fee = _amount.mul(serviceFee).div(SERVICE_FEE_DIVISOR);
        IERC20(stakedRebaseToken).safeTransfer(serviceFeeRecipient, fee);
        return _amount.sub(fee);
    }

    /* ======== STRATEGY UPGRADE FUNCTIONS ======== */

    /**
     * @dev Retire strategy
     * @notice Called as part of strat migration.
     * @notice Sends all the available funds back to the vault
     */
    function retireStrat() external {
        require(msg.sender == vault, "!vault");
        require(reserves <= 0, "Reserves must be empty!");
        require(!isBonding(), "Cannot retire while bonding!");

        if (!paused()) _pause();
        _unstake(stakedRebasing());

        IERC20(rebaseToken).safeTransfer(vault, unstakedRebasing());
    }

    /* ======== EMERGENCY CONTROL FUNCTIONS ======== */

    /**
     * @dev Pauses deposits and withdraws all funds from third party systems
     */
    function panic() external onlyOwner {
        if (!paused()) _pause();
        if (isBonding()) _redeem();
        _unstake(stakedRebasing());
    }

    /**
     * @dev Pauses deposits
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses deposits
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Stakes all unstaked {rebaseToken} locked
     */
    function stake() external onlyOwner {
        _stake();
    }

    /**
     * @dev Unstakes all unstaked {rebaseToken} locked
     */
    function unstakeAll() external onlyOwner {
        _unstake(stakedRebasing());
    }

    /**
     * @dev Unstakes _amount of staked {rebaseToken}
     * @param _amount of staked {rebaseToken} to unstake
     */
    function unstake(uint256 _amount) external onlyOwner {
        _unstake(_amount);
    }

    /**
     * @dev Rescues random funds stuck that the strat can't handle
     * @param _token address of the token to rescue
     */
    function inCaseTokensGetStuck(address _token) external onlyOwner {
        require(_token != rebaseToken && _token != stakedRebaseToken, "!token");

        uint256 amount = IERC20(_token).balanceOf(address(this));
        IERC20(_token).safeTransfer(msg.sender, amount);
    }

    /* ======== UTILITY FUNCTIONS ======== */

    /**
     * @dev Returns the max amount of SPA that can be bonded into the given bond
     * @param bondDepository BondDepository to calculate the max bond size for
     */
    function maxBondSize(IBondDepository bondDepository)
        public
        view
        returns (uint256)
    {
        return
            bondDepository.bondPriceInUSD().mul(bondDepository.maxPayout()).div(
                rebaseTokenPriceInUSD(1e9)
            );
    }

    /**
     * @dev Whether or not a bond is positive
     * @param bondDepository The bond to examine
     */
    function bondIsPositive(IBondDepository bondDepository)
        public
        view
        returns (bool)
    {
        return bondDepository.bondPriceInUSD() < rebaseTokenPriceInUSD(1e9);
    }

    /**
     * @dev Get amount required in to receive an amount out
     * @param _amountOut Exact amount out
     * @param _inToOutRoute Route to swap from in to out
     * @notice Includes price impact
     */
    function getAmountIn(uint256 _amountOut, address[] calldata _inToOutRoute)
        external
        view
        returns (uint256)
    {
        return
            IUniswapRouterETH(unirouter).getAmountsIn(
                _amountOut,
                _inToOutRoute
            )[0];
    }

    /**
     * @dev Get amount received out from an exact amount in
     * @param _amountIn Exact amount in
     * @param _inToOutRoute Route to swap from in to out
     * @notice Includes price impact
     */
    function getAmountOut(uint256 _amountIn, address[] calldata _inToOutRoute)
        external
        view
        returns (uint256)
    {
        return
            IUniswapRouterETH(unirouter).getAmountsOut(
                _amountIn,
                _inToOutRoute
            )[_inToOutRoute.length - 1];
    }

    /**
     * @dev Convert token amount to {rebaseToken}
     * @param _tokenAmount to convert to {rebaseToken}
     * @param _tokenRebasePair Pair for calculation
     * @notice Does not include price impact
     */
    function tokenToRebase(
        uint256 _tokenAmount,
        IUniswapV2Pair _tokenRebasePair
    ) external view returns (uint256) {
        (uint256 Res0, uint256 Res1, ) = _tokenRebasePair.getReserves();
        // return # of {token} needed to buy _amount of rebaseToken
        return _tokenAmount.mul(Res1).div(Res0);
    }

    /**
     * @dev Get {rebaseToken} price in USD denomination
     * @param _amount of {rebaseToken}
     * @notice Does not include price impact
     */
    function rebaseTokenPriceInUSD(uint256 _amount)
        public
        view
        returns (uint256)
    {
        (uint256 Res0, uint256 Res1, ) = rebaseTokenDaiPair.getReserves();
        // return # of Dai needed to buy _amount of rebaseToken
        return _amount.mul(Res1).div(Res0);
    }
}
