// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IFactVerifier, StateLiftEscrow} from "./StateLiftEscrow.sol";
import {RootInbox} from "../proof/RootInbox.sol";
import {StateProofVerifier} from "../proof/StateProofVerifier.sol";
import {MerklePatricia} from "../proof/MerklePatricia.sol";
import {StrictRLP} from "../proof/StrictRLP.sol";
import {NativeReceiptPolicy} from "./NativeReceiptPolicy.sol";

/// @notice Direct, uncompressed baseline for one immutable USDC version manifest.
/// Relies on issuer preserving monotonic nonce history; does not eliminate issuer trust.
contract StateLiftFactVerifier is IFactVerifier {
    struct Manifest {
        address token;
        bytes32 proxyCodeHash;
        bytes32 implementationSlot;
        address implementation;
        bytes32 implementationCodeHash;
        uint256 authorizationMappingSlot;
    }
    struct Evidence {
        address hub;
        address owner;
        StateLiftEscrow.GoalInput goal;
        StateLiftEscrow.Quote quote;
        bytes32 blockHash;
        bytes[] tokenAccountProof;
        bytes[] implementationPointerProof;
        bytes[] implementationAccountProof;
        bytes[] nonceProof;
        bool expiredUnused;
        uint256 transactionIndex;
        bytes[][] blockReceiptProofs;
        bytes[] endReceiptProof;
    }
    RootInbox public immutable inbox;
    StateProofVerifier public immutable stateVerifier;
    bytes32 public immutable manifestId;
    Manifest public manifest;
    bytes32 public constant QUOTE_TYPEHASH =
        keccak256(
            "Quote(bytes32 goalContextHash,bytes32 goalId,uint32 attemptNumber,address solver,address authorizer,uint64 validAfter,uint64 validBefore,uint64 acceptBefore,uint256 principal,uint256 serviceCap,uint256 proofReward,uint256 bond,uint256 nonfulfillmentPenalty,uint256 solverNonce)"
        );
    bytes32 public constant NONCE_DOMAIN =
        keccak256("StateLift.sourceNonce.v1");
    error InvalidManifest();
    error InvalidEvidence();
    error UpgradeInExecutionBlock();
    constructor(
        address rootInbox,
        address genericStateVerifier,
        Manifest memory supported
    ) {
        inbox = RootInbox(rootInbox);
        stateVerifier = StateProofVerifier(genericStateVerifier);
        if (
            address(stateVerifier.inbox()) != rootInbox ||
            supported.token == address(0) ||
            supported.implementation == address(0) ||
            supported.proxyCodeHash == 0 ||
            supported.implementationCodeHash == 0
        ) revert InvalidManifest();
        manifest = supported;
        manifestId = keccak256(
            abi.encode(
                inbox.sourceDomain(),
                supported,
                keccak256(
                    "StateLift.CircleERC3009.no-upgrade-execution-block.v1"
                )
            )
        );
    }
    function verify(
        bytes calldata encoded
    ) external view returns (Fact memory) {
        return verifyEvidence(abi.decode(encoded, (Evidence)));
    }
    function verifyEvidence(
        Evidence memory e
    ) public view returns (Fact memory f) {
        if (
            e.hub == address(0) ||
            e.owner == address(0) ||
            e.goal.sourceDomain != inbox.sourceDomain() ||
            e.goal.manifestId != manifestId ||
            e.goal.token != manifest.token ||
            e.quote.authorizer == address(0) ||
            e.goal.recipient == e.quote.authorizer ||
            e.goal.recipient == e.goal.token ||
            e.goal.recipient == address(0) ||
            e.quote.validBefore <= e.quote.validAfter
        ) revert InvalidEvidence();
        bytes32 context = keccak256(
            abi.encode(block.chainid, e.hub, e.quote.goalId, e.owner, e.goal)
        );
        f.termsHash = keccak256(abi.encode(QUOTE_TYPEHASH, context, e.quote));
        bytes32 nonce = keccak256(abi.encode(NONCE_DOMAIN, f.termsHash));
        RootInbox.Header memory h = inbox.getHeader(e.blockHash);
        f.sourceTimestamp = h.timestamp;
        checkVersion(e, h);
        if (e.expiredUnused) {
            if (h.timestamp < e.quote.validBefore) revert InvalidEvidence();
            bytes32 inner = keccak256(
                abi.encode(
                    e.quote.authorizer,
                    manifest.authorizationMappingSlot
                )
            );
            bytes32 slot = keccak256(abi.encode(nonce, inner));
            StateProofVerifier.StorageFact memory sf = stateVerifier
                .storageFact(
                    e.blockHash,
                    manifest.token,
                    slot,
                    e.tokenAccountProof,
                    e.nonceProof
                );
            if (
                !sf.accountPresent ||
                sf.codeHash != manifest.proxyCodeHash ||
                sf.value != 0
            ) revert InvalidEvidence();
            f.outcome = 2;
            return f;
        }
        bytes memory selected = checkExecutionBlock(e, h);
        f.outcome = NativeReceiptPolicy.classify(
            selected,
            manifest.token,
            e.quote.authorizer,
            nonce,
            e.goal.recipient,
            e.goal.usdcAmount,
            h.timestamp,
            e.quote.validAfter,
            e.quote.validBefore
        );
    }
    function checkVersion(
        Evidence memory e,
        RootInbox.Header memory h
    ) private view {
        StateProofVerifier.StorageFact memory pointer = stateVerifier
            .storageFact(
                e.blockHash,
                manifest.token,
                manifest.implementationSlot,
                e.tokenAccountProof,
                e.implementationPointerProof
            );
        if (
            !pointer.accountPresent ||
            pointer.codeHash != manifest.proxyCodeHash ||
            pointer.value != uint256(uint160(manifest.implementation))
        ) revert InvalidManifest();
        (bool present, bytes memory raw) = MerklePatricia.get(
            h.stateRoot,
            abi.encodePacked(
                keccak256(abi.encodePacked(manifest.implementation))
            ),
            e.implementationAccountProof
        );
        if (!present) revert InvalidManifest();
        StrictRLP.Item[] memory fields = StrictRLP.children(raw, 4);
        if (
            fields.length != 4 ||
            StrictRLP.hash32(raw, fields[3]) != manifest.implementationCodeHash
        ) revert InvalidManifest();
        StrictRLP.scalar(raw, fields[0]);
        StrictRLP.scalar(raw, fields[1]);
        StrictRLP.hash32(raw, fields[2]);
    }
    function checkExecutionBlock(
        Evidence memory e,
        RootInbox.Header memory h
    ) private view returns (bytes memory selected) {
        uint256 n = e.blockReceiptProofs.length;
        if (n == 0 || n > 1024 || e.transactionIndex >= n)
            revert InvalidEvidence();
        // All receipt indices, plus proven absence at n, close the upgrade-log search.
        // This is deliberately costly: the SP1 path must later prove the same statement.
        for (uint256 i; i < n; ++i) {
            (bool present, bytes memory raw) = MerklePatricia.get(
                h.receiptsRoot,
                stateVerifier.indexKey(i),
                e.blockReceiptProofs[i]
            );
            if (!present) revert InvalidEvidence();
            (, NativeReceiptPolicy.Log[] memory logs) = NativeReceiptPolicy
                .decode(raw);
            if (NativeReceiptPolicy.hasUpgrade(logs, manifest.token))
                revert UpgradeInExecutionBlock();
            if (i == e.transactionIndex) selected = raw;
        }
        (bool extra, ) = MerklePatricia.get(
            h.receiptsRoot,
            stateVerifier.indexKey(n),
            e.endReceiptProof
        );
        if (extra) revert InvalidEvidence();
    }
}
