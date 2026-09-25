// SPDX-License-Identifier: LicenseRef-Degensoft-SwapVM-1.1
pragma solidity 0.8.30;

import { Simulator } from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import { SwapVM } from "@1inch/swap-vm/contracts/SwapVM.sol";
import { Context } from "@1inch/swap-vm/contracts/libs/VM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/contracts/opcodes/AquaOpcodes.sol";

import { TrimSkew } from "./instructions/TrimSkew.sol";

contract TrimSwapVMRouter is Simulator, SwapVM, AquaOpcodes {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version)
    { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        if (opcode == uint8(TrimSkew.opcode)) TrimSkew.exec(ctx, args);
        else _runOpcode(ctx, opcode, args);
    }
}
