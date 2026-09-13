// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {RootInbox} from "./RootInbox.sol";
import {StrictRLP} from "./StrictRLP.sol";
import {MerklePatricia} from "./MerklePatricia.sol";

/// @notice Generic historical facts. This contract does NOT interpret USDC payment outcomes.
contract StateProofVerifier {
    struct StorageFact {
        bool accountPresent;
        bool slotPresent;
        bytes32 codeHash;
        bytes32 storageRoot;
        uint256 value;
        uint64 height;
        uint64 timestamp;
    }
    RootInbox public immutable inbox;
    error InvalidAccount();
    error InvalidValue();
    error MissingReceipt();
    constructor(address rootInbox) {
        if (rootInbox == address(0)) revert InvalidAccount();
        inbox = RootInbox(rootInbox);
    }
    function storageFact(
        bytes32 blockHash,
        address account,
        bytes32 slot,
        bytes[] calldata accountProof,
        bytes[] calldata slotProof
    ) external view returns (StorageFact memory f) {
        RootInbox.Header memory h = inbox.getHeader(blockHash);
        f.height = h.height;
        f.timestamp = h.timestamp;
        bytes memory accountValue;
        (f.accountPresent, accountValue) = accountAt(
            h.stateRoot,
            account,
            accountProof
        );
        if (!f.accountPresent) {
            if (slotProof.length != 0) revert InvalidAccount();
            return f;
        }
        StrictRLP.Item[] memory fields = StrictRLP.children(accountValue, 4);
        if (fields.length != 4) revert InvalidAccount();
        StrictRLP.scalar(accountValue, fields[0]);
        StrictRLP.scalar(accountValue, fields[1]);
        f.storageRoot = StrictRLP.hash32(accountValue, fields[2]);
        f.codeHash = StrictRLP.hash32(accountValue, fields[3]);
        bytes memory value;
        (f.slotPresent, value) = MerklePatricia.get(
            f.storageRoot,
            abi.encodePacked(keccak256(abi.encodePacked(slot))),
            slotProof
        );
        if (f.slotPresent) {
            StrictRLP.Item memory scalar = StrictRLP.item(value, 0);
            if (scalar.size != value.length) revert InvalidValue();
            f.value = StrictRLP.scalar(value, scalar);
        }
    }
    function accountAt(
        bytes32 stateRoot,
        address account,
        bytes[] memory nodes
    ) internal pure returns (bool, bytes memory) {
        return
            MerklePatricia.get(
                stateRoot,
                abi.encodePacked(keccak256(abi.encodePacked(account))),
                nodes
            );
    }
    function receipt(
        bytes32 blockHash,
        uint256 transactionIndex,
        bytes[] calldata receiptProof
    ) external view returns (bytes memory raw, uint64 timestamp) {
        RootInbox.Header memory h = inbox.getHeader(blockHash);
        bool present;
        (present, raw) = MerklePatricia.get(
            h.receiptsRoot,
            indexKey(transactionIndex),
            receiptProof
        );
        if (!present) revert MissingReceipt();
        return (raw, h.timestamp);
    }
    function indexKey(uint256 value) public pure returns (bytes memory out) {
        if (value == 0) return hex"80";
        if (value < 128) {
            out = new bytes(1);
            out[0] = bytes1(uint8(value));
            return out;
        }
        uint256 x = value;
        uint256 n;
        while (x != 0) {
            ++n;
            x >>= 8;
        }
        out = new bytes(n + 1);
        out[0] = bytes1(uint8(128 + n));
        for (uint256 i; i < n; ++i)
            out[n - i] = bytes1(uint8(value >> (i * 8)));
    }
}
