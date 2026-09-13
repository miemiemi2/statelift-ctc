// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {StrictRLP} from "./StrictRLP.sol";

/// @notice Canonical hexary MPT inclusion/non-inclusion verification; bounded inputs.
library MerklePatricia {
    error BadTrieProof();
    function get(
        bytes32 root,
        bytes memory key,
        bytes[] memory proof
    ) internal pure returns (bool present, bytes memory value) {
        if (key.length == 0 || key.length > 64 || proof.length > 128)
            revert BadTrieProof();
        if (root == keccak256(hex"80")) {
            if (proof.length != 0) revert BadTrieProof();
            return (false, hex"");
        }
        bytes memory expected = abi.encodePacked(root);
        uint256 used;
        uint256 position;
        bool rootNode = true;
        for (uint256 steps; steps <= key.length * 2 + 1; ++steps) {
            bytes memory node;
            if (expected.length == 32) {
                if (used >= proof.length) revert BadTrieProof();
                node = proof[used++];
                if (
                    node.length > 65536 ||
                    (!rootNode && node.length < 32) ||
                    keccak256(node) != bytes32(expected)
                ) revert BadTrieProof();
            } else {
                if (expected.length == 0 || expected.length >= 32)
                    revert BadTrieProof();
                node = expected;
                // Some clients also list inline children. Consume only an exact duplicate.
                if (
                    used < proof.length &&
                    keccak256(proof[used]) == keccak256(node)
                ) ++used;
            }
            rootNode = false;
            StrictRLP.Item[] memory f = StrictRLP.children(node, 17);
            if (f.length == 17) {
                if (position == key.length * 2) {
                    if (used != proof.length || f[16].list)
                        revert BadTrieProof();
                    return (
                        f[16].length != 0,
                        StrictRLP.slice(node, f[16].payload, f[16].length)
                    );
                }
                uint256 index = nibble(key, position++);
                expected = child(node, f[index]);
                if (expected.length == 0) {
                    if (used != proof.length) revert BadTrieProof();
                    return (false, hex"");
                }
            } else if (f.length == 2) {
                if (f[0].list || f[0].length == 0) revert BadTrieProof();
                bytes memory compact = StrictRLP.slice(
                    node,
                    f[0].payload,
                    f[0].length
                );
                uint256 flag = uint8(compact[0]) >> 4;
                if (flag > 3) revert BadTrieProof();
                bool odd = (flag & 1) != 0;
                bool leaf = (flag & 2) != 0;
                if (!odd && (uint8(compact[0]) & 15) != 0)
                    revert BadTrieProof();
                uint256 offset = odd ? 1 : 2;
                uint256 length = compact.length * 2 - offset;
                if (!leaf && length == 0) revert BadTrieProof();
                bool matches = position + length <= key.length * 2;
                for (uint256 i; matches && i < length; ++i)
                    if (
                        nibble(compact, offset + i) != nibble(key, position + i)
                    ) matches = false;
                if (!matches) {
                    if (used != proof.length) revert BadTrieProof();
                    return (false, hex"");
                }
                position += length;
                if (leaf) {
                    if (used != proof.length || f[1].list)
                        revert BadTrieProof();
                    if (position != key.length * 2) return (false, hex"");
                    return (
                        true,
                        StrictRLP.slice(node, f[1].payload, f[1].length)
                    );
                }
                expected = child(node, f[1]);
                if (expected.length == 0) revert BadTrieProof();
            } else revert BadTrieProof();
        }
        revert BadTrieProof();
    }
    function child(
        bytes memory node,
        StrictRLP.Item memory p
    ) private pure returns (bytes memory) {
        if (p.list) {
            if (p.size >= 32) revert BadTrieProof();
            return StrictRLP.slice(node, p.start, p.size);
        }
        if (p.length != 0 && p.length != 32) revert BadTrieProof();
        return StrictRLP.slice(node, p.payload, p.length);
    }
    function nibble(
        bytes memory data,
        uint256 at
    ) private pure returns (uint256) {
        uint256 b = uint8(data[at / 2]);
        return at % 2 == 0 ? b >> 4 : b & 15;
    }
}
