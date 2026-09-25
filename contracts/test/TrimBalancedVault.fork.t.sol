// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/contracts/libs/TakerTraits.sol";
import { MockTaker } from "@1inch/swap-vm/test/solidity/mocks/MockTaker.sol";

import { TrimSkew } from "../src/instructions/TrimSkew.sol";
import { TrimSwapVMRouter } from "../src/TrimSwapVMRouter.sol";
import { TrimOrders } from "../src/TrimOrders.sol";
import { TrimBalancedVault } from "../src/TrimBalancedVault.sol";
import { IAaveOracle } from "../src/interfaces/aave/IAaveOracle.sol";

contract TrimBalancedVaultForkTest is Test {
    uint256 constant FORK_BLOCK = 26_050_000;
    IAaveOracle constant ORACLE = IAaveOracle(0x54586bE62E3c3580375aE3723C145253060Ca0C2);
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    uint16 constant MAX_DISCOUNT_BPS = 300;
    uint64 constant FULL_DEVIATION = 0.2e18;

    Aqua aqua;
    TrimSwapVMRouter router;
    TrimBalancedVault vault;
    MockTaker taker;
    ISwapVM.Order order;
    address owner = makeAddr("owner");
    uint256 wethPrice;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("mainnet"), FORK_BLOCK);
        aqua = new Aqua();
        router = new TrimSwapVMRouter(address(aqua), WETH, address(this), "Trim", "1");
        vault = new TrimBalancedVault(ORACLE, aqua, address(router), WETH, USDC, owner);
        taker = new MockTaker(aqua, router, address(this));
        wethPrice = ORACLE.getAssetPrice(WETH);

        uint256 usdcForHalf = 10e18 * wethPrice / ORACLE.getAssetPrice(USDC) / 1e12;
        deal(WETH, address(vault), 10e18);
        deal(USDC, address(vault), usdcForHalf);
        order = TrimOrders.build(address(vault), WETH, USDC, false, MAX_DISCOUNT_BPS, FULL_DEVIATION);
        vm.prank(owner);
        vault.ship(order);
    }

    function test_BalancedVaultHasNoOffer() public {
        assertEq(vault.deviation(), 0);

        vm.expectRevert(TrimSkew.TrimSkewOnTarget.selector);
        router.quote(order, 1_000e6, _takerData(USDC, WETH));
    }

    function test_EtherRallySellsEtherForDollars() public {
        _setWethPrice(120);
        uint256 before = vault.deviation();
        assertGt(before, 0);

        deal(USDC, address(taker), 2_000e6);
        (uint256 amountIn, uint256 amountOut) = taker.swap(order, 2_000e6, _takerData(USDC, WETH));

        assertEq(amountIn, 2_000e6);
        assertGt(amountOut, vault.fairAmountOut(USDC, WETH, 2_000e6));
        assertLt(vault.deviation(), before);
    }

    function test_EtherSlumpSellsDollarsForEther() public {
        _setWethPrice(80);
        uint256 before = vault.deviation();

        deal(WETH, address(taker), 1e18);
        (, uint256 amountOut) = taker.swap(order, 1e18, _takerData(WETH, USDC));

        assertGt(amountOut, vault.fairAmountOut(WETH, USDC, 1e18));
        assertLt(vault.deviation(), before);
    }

    function test_BuyingTheUnderweightTokenIsRejected() public {
        _setWethPrice(120);

        vm.expectRevert(TrimBalancedVault.TrimWrongDirection.selector);
        vault.deviationAfter(WETH, USDC, 1e18, 1_000e6);
    }

    function test_OvershootingPastBalanceIsRejected() public {
        _setWethPrice(120);

        vm.expectRevert();
        router.quote(order, 20_000e6, _takerData(USDC, WETH));
    }

    function _setWethPrice(uint256 percentOfOpen) internal {
        vm.mockCall(
            address(ORACLE),
            abi.encodeCall(IAaveOracle.getAssetPrice, (WETH)),
            abi.encode(wethPrice * percentOfOpen / 100)
        );
    }

    function _takerData(address tokenIn, address tokenOut) internal view returns (bytes memory) {
        return TakerTraitsLib.build(TakerTraitsLib.Args({
            taker: address(taker),
            isExactIn: true,
            shouldUnwrapWeth: false,
            hasPreTransferInCallback: true,
            hasPreTransferOutCallback: false,
            isStrictThresholdAmount: false,
            isFirstTransferFromTaker: true,
            useTransferFromAndAquaPush: false,
            isAToB: tokenIn < tokenOut,
            allowPartialFill: false,
            usePermit2: false,
            threshold: "",
            to: address(0),
            deadline: 0,
            preTransferInHookData: "",
            postTransferInHookData: "",
            preTransferOutHookData: "",
            postTransferOutHookData: "",
            preTransferInCallbackData: "",
            preTransferOutCallbackData: "",
            instructionsArgs: "",
            signature: ""
        }));
    }
}
