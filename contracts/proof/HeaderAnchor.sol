// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
contract HeaderAnchor {
    event HeaderAnchored(
        uint256 indexed sourceChainId,
        uint256 indexed height,
        bytes32 canonicalBlockHash
    );
    error UnavailableHeight();
    error UnavailableHash();
    function anchor(uint256 height) external {
        if (height >= block.number || block.number - height > 256)
            revert UnavailableHeight();
        bytes32 h = blockhash(height);
        if (h == bytes32(0)) revert UnavailableHash();
        emit HeaderAnchored(block.chainid, height, h);
    }
}
