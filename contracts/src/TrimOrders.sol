// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ISwapVM } from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/contracts/libs/MakerTraits.sol";

import { TrimSkew } from "./instructions/TrimSkew.sol";

library TrimOrders {
    function build(address maker, address tokenX, address tokenY, bool withHooks, uint16 maxDiscountBps, uint64 fullDeviation)
        internal
        pure
        returns (ISwapVM.Order memory)
    {
        (address tokenA, address tokenB) = tokenX < tokenY ? (tokenX, tokenY) : (tokenY, tokenX);
        return MakerTraitsLib.build(MakerTraitsLib.Args({
            maker: maker,
            tokenA: tokenA,
            tokenB: tokenB,
            shouldUnwrapWeth: false,
            useAquaInsteadOfSignature: true,
            usePermit2: false,
            allowZeroAmountIn: false,
            receiver: address(0),
            hasPreTransferInHook: false,
            hasPostTransferInHook: withHooks,
            hasPreTransferOutHook: withHooks,
            hasPostTransferOutHook: false,
            preTransferInTarget: address(0),
            preTransferInData: "",
            postTransferInTarget: withHooks ? maker : address(0),
            postTransferInData: "",
            preTransferOutTarget: withHooks ? maker : address(0),
            preTransferOutData: "",
            postTransferOutTarget: address(0),
            postTransferOutData: "",
            program: TrimSkew.build(maker, maxDiscountBps, fullDeviation)
        }));
    }
}
