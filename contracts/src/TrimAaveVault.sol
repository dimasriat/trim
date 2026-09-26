// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { IMakerHooks } from "@1inch/swap-vm/contracts/interfaces/IMakerHooks.sol";

import { ITrimSource } from "./interfaces/ITrimSource.sol";
import { IAavePool } from "./interfaces/aave/IAavePool.sol";
import { IAaveOracle } from "./interfaces/aave/IAaveOracle.sol";

/// @title TrimAaveVault
/// @notice Aave v3 position (collateral in, variable debt out; WETH/USDC in the demo) that sells collateral
///         through Aqua to repay its debt whenever its health factor is below target.
/// @dev deviation = (targetHF - HF) / targetHF. It only deleverages: debt token in, collateral token out.
///      Selling the other way would lower the health factor, the opposite of what the vault wants.
///      Collateral stays supplied in Aave until a fill: preTransferOut withdraws exactly what leaves,
///      postTransferIn repays with what arrives.
contract TrimAaveVault is ITrimSource, IMakerHooks, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Hook called by someone other than the router, for another maker, or for a stale order.
    /// @dev Also thrown by the two hooks this vault does not use.
    error TrimNotOwnOrder();
    /// @notice The fill is not debt token in, collateral token out.
    error TrimWrongDirection();
    /// @notice The fill would push the health factor past the target.
    /// @param healthFactorAfter Health factor after the fill; type(uint256).max when it would repay all debt.
    error TrimOvershoot(uint256 healthFactorAfter);
    /// @notice The order's maker is not this vault.
    /// @param maker The order's maker.
    error TrimOrderMakerMismatch(address maker);

    /// @dev Aave interest rate mode for variable debt.
    uint256 constant VARIABLE_RATE = 2;
    /// @dev Aave's liquidation threshold is in basis points.
    uint256 constant PERCENT = 10_000;

    /// @notice Aave v3 pool holding the position.
    IAavePool public immutable pool;
    /// @notice Aave price oracle used for fair prices and the post-fill health factor.
    IAaveOracle public immutable oracle;
    /// @notice Aqua instance the order is shipped to.
    IAqua public immutable aqua;
    /// @notice SwapVM router that runs the order; the only accepted hook caller.
    address public immutable router;
    /// @notice Supplied asset, the token this vault sells.
    IERC20 public immutable collateral;
    /// @notice Borrowed asset, the token this vault buys and repays.
    IERC20 public immutable debt;
    /// @notice Health factor the vault trims back to, scaled by 1e18.
    uint256 public immutable targetHealthFactor;
    /// @dev 10 ** collateral decimals.
    uint256 immutable collateralUnit;
    /// @dev 10 ** debt decimals.
    uint256 immutable debtUnit;

    /// @notice Hash of the latest shipped order; hooks reject any other.
    bytes32 public orderHash;

    /// @param pool_ Aave v3 pool.
    /// @param oracle_ Aave price oracle.
    /// @param aqua_ Aqua instance.
    /// @param router_ SwapVM router running the order.
    /// @param collateral_ Collateral token.
    /// @param debt_ Debt token.
    /// @param targetHealthFactor_ Target health factor, scaled by 1e18.
    /// @param owner_ Owner allowed to open the position and ship orders.
    constructor(
        IAavePool pool_,
        IAaveOracle oracle_,
        IAqua aqua_,
        address router_,
        address collateral_,
        address debt_,
        uint256 targetHealthFactor_,
        address owner_
    ) Ownable(owner_) {
        pool = pool_;
        oracle = oracle_;
        aqua = aqua_;
        router = router_;
        collateral = IERC20(collateral_);
        debt = IERC20(debt_);
        targetHealthFactor = targetHealthFactor_;
        collateralUnit = 10 ** IERC20Metadata(collateral_).decimals();
        debtUnit = 10 ** IERC20Metadata(debt_).decimals();
    }

    /// @notice Opens the position: supplies collateral from the owner and borrows debt at variable rate.
    /// @dev The borrowed debt tokens are sent to the owner.
    /// @param collateralAmount Collateral pulled from the owner and supplied.
    /// @param debtAmount Debt borrowed and forwarded to the owner.
    function open(uint256 collateralAmount, uint256 debtAmount) external onlyOwner {
        collateral.safeTransferFrom(msg.sender, address(this), collateralAmount);
        collateral.forceApprove(address(pool), collateralAmount);
        pool.supply(address(collateral), collateralAmount, address(this), 0);
        pool.borrow(address(debt), debtAmount, VARIABLE_RATE, 0, address(this));
        debt.safeTransfer(msg.sender, debtAmount);
    }

    /// @notice Ships `order` to Aqua with this vault as maker and makes it the only order the hooks accept.
    /// @dev Aqua gets 0 debt and a virtual `collateralLimit` of collateral: the vault holds no idle collateral,
    ///      preTransferOut withdraws it from Aave per fill. Overwriting orderHash disables earlier orders.
    /// @param order SwapVM order whose maker must be this vault.
    /// @param collateralLimit Maximum collateral the order may sell through Aqua.
    /// @return Strategy hash returned by Aqua.
    function ship(ISwapVM.Order calldata order, uint256 collateralLimit) external onlyOwner returns (bytes32) {
        require(order.maker == address(this), TrimOrderMakerMismatch(order.maker));
        orderHash = ISwapVM(router).hash(order);
        collateral.forceApprove(address(aqua), type(uint256).max);
        address[] memory tokens = new address[](2);
        tokens[0] = address(debt);
        tokens[1] = address(collateral);
        uint256[] memory amounts = new uint256[](2);
        amounts[1] = collateralLimit;
        return aqua.ship(router, abi.encode(order), tokens, amounts);
    }

    /// @notice Current Aave health factor of the position.
    /// @return value Health factor scaled by 1e18.
    function healthFactor() public view returns (uint256 value) {
        (,,,,, value) = pool.getUserAccountData(address(this));
    }

    /// @notice (targetHF - HF) / targetHF, scaled by 1e18; 0 at or above target.
    /// @return Current deviation.
    function deviation() external view returns (uint256) {
        uint256 current = healthFactor();
        if (current >= targetHealthFactor) return 0;
        return (targetHealthFactor - current) * 1e18 / targetHealthFactor;
    }

    /// @notice Deviation after repaying `amountIn` debt and withdrawing `amountOut` collateral.
    /// @dev HF after = (collateral - withdrawn) * liquidationThreshold / (debt - repaid), in Aave base currency,
    ///      using the account's current average liquidation threshold. Reverts TrimOvershoot if the fill
    ///      repays all debt or lands above target, and TrimWrongDirection unless debt in, collateral out.
    /// @param tokenIn Must be the debt token.
    /// @param tokenOut Must be the collateral token.
    /// @param amountIn Debt repaid.
    /// @param amountOut Collateral withdrawn.
    /// @return Deviation after the fill, scaled by 1e18.
    function deviationAfter(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external view returns (uint256) {
        _requireDeleverage(tokenIn, tokenOut);
        (uint256 collateralBase, uint256 debtBase,, uint256 liquidationThreshold,,) = pool.getUserAccountData(address(this));
        uint256 repaidBase = amountIn * oracle.getAssetPrice(address(debt)) / debtUnit;
        uint256 withdrawnBase = amountOut * oracle.getAssetPrice(address(collateral)) / collateralUnit;
        require(repaidBase < debtBase, TrimOvershoot(type(uint256).max));
        uint256 after_ = (collateralBase - withdrawnBase) * liquidationThreshold * 1e18 / (PERCENT * (debtBase - repaidBase));
        require(after_ <= targetHealthFactor, TrimOvershoot(after_));
        return (targetHealthFactor - after_) * 1e18 / targetHealthFactor;
    }

    /// @notice Collateral worth `amountIn` debt at oracle prices, rounded down.
    /// @param tokenIn Must be the debt token.
    /// @param tokenOut Must be the collateral token.
    /// @param amountIn Debt amount.
    /// @return Collateral amount.
    function fairAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        _requireDeleverage(tokenIn, tokenOut);
        return amountIn * oracle.getAssetPrice(address(debt)) * collateralUnit / (oracle.getAssetPrice(address(collateral)) * debtUnit);
    }

    /// @notice Debt worth `amountOut` collateral at oracle prices, rounded up.
    /// @param tokenIn Must be the debt token.
    /// @param tokenOut Must be the collateral token.
    /// @param amountOut Collateral amount.
    /// @return Debt amount.
    function fairAmountIn(address tokenIn, address tokenOut, uint256 amountOut) external view returns (uint256) {
        _requireDeleverage(tokenIn, tokenOut);
        return Math.ceilDiv(amountOut * oracle.getAssetPrice(address(collateral)) * debtUnit, oracle.getAssetPrice(address(debt)) * collateralUnit);
    }

    /// @notice Unused hook; always reverts.
    function preTransferIn(address, address, address, address, uint256, uint256, bytes32, bytes calldata, bytes calldata) external pure {
        revert TrimNotOwnOrder();
    }

    /// @notice Repays debt with the tokens that just arrived through Aqua.
    /// @dev Runs after the taker's push, which moved the debt tokens to this vault. Repays amountIn - feeIn,
    ///      since the protocol fee is taken from the vault's Aqua balance. Router and own latest order only.
    /// @param maker Must be this vault.
    /// @param amountIn Debt tokens paid in by the taker.
    /// @param feeIn Protocol fee on the input.
    /// @param orderHash_ Must equal orderHash.
    function postTransferIn(
        address maker,
        address,
        address,
        address,
        uint256 amountIn,
        uint256,
        uint256 feeIn,
        bytes32 orderHash_,
        bytes calldata,
        bytes calldata
    ) external {
        _requireOwnOrder(maker, orderHash_);
        uint256 amount = amountIn - feeIn;
        debt.forceApprove(address(pool), amount);
        pool.repay(address(debt), amount, VARIABLE_RATE, address(this));
    }

    /// @notice Withdraws from Aave the collateral about to leave, so Aqua can pull it from this vault.
    /// @dev Runs before the router pulls tokenOut. Router and own latest order only.
    /// @param maker Must be this vault.
    /// @param amountOut Collateral about to be sent to the taker.
    /// @param orderHash_ Must equal orderHash.
    function preTransferOut(
        address maker,
        address,
        address,
        address,
        uint256,
        uint256 amountOut,
        bytes32 orderHash_,
        bytes calldata,
        bytes calldata
    ) external {
        _requireOwnOrder(maker, orderHash_);
        pool.withdraw(address(collateral), amountOut, address(this));
    }

    /// @notice Unused hook; always reverts.
    function postTransferOut(address, address, address, address, uint256, uint256, uint256, bytes32, bytes calldata, bytes calldata) external pure {
        revert TrimNotOwnOrder();
    }

    /// @dev Caller is the router, maker is this vault, and the order is the latest shipped one.
    function _requireOwnOrder(address maker, bytes32 orderHash_) internal view {
        require(msg.sender == router && maker == address(this) && orderHash_ == orderHash, TrimNotOwnOrder());
    }

    /// @dev Debt token in, collateral token out.
    function _requireDeleverage(address tokenIn, address tokenOut) internal view {
        require(tokenIn == address(debt) && tokenOut == address(collateral), TrimWrongDirection());
    }
}
