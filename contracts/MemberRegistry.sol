// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MemberRegistry
 * @notice Identity layer for a permissioned direct-democracy network.
 *
 * One organisation runs one registry. A registrar (the org secretary, in
 * practice) maps a wallet address to a member record. The record stores a hash
 * of the member's real-world identifier -- a student registration number, a
 * flat number, a cooperative membership ID -- never the identifier itself, so
 * the ledger carries proof of enrolment without carrying personal data.
 *
 * Everything the voting contract needs to answer "is this address allowed to
 * vote, and has it been counted once" lives here.
 */
contract MemberRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Member {
        bytes32 memberIdHash; // keccak256 of the off-chain identifier
        uint64 enrolledAt; // block timestamp of enrolment
        bool active; // false once suspended
        bool exists; // distinguishes "never enrolled" from "suspended"
    }

    mapping(address => Member) private _members;
    mapping(bytes32 => address) private _idHashToAddress;

    address[] private _roster;
    uint256 private _activeCount;

    event MemberEnrolled(address indexed account, bytes32 indexed memberIdHash, uint64 enrolledAt);
    event MemberSuspended(address indexed account, bytes32 indexed memberIdHash);
    event MemberReinstated(address indexed account, bytes32 indexed memberIdHash);

    error AlreadyEnrolled(address account);
    error IdentifierAlreadyUsed(bytes32 memberIdHash, address heldBy);
    error NotEnrolled(address account);
    error AlreadyActive(address account);
    error AlreadySuspended(address account);
    error EmptyIdentifier();
    error LengthMismatch();

    /**
     * @param admin Address that can grant and revoke the registrar role.
     *              It is also given the registrar role at deployment so a
     *              single-officer organisation works out of the box.
     */
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    /// @notice Add one wallet to the member roster.
    function enrol(address account, bytes32 memberIdHash) public onlyRole(REGISTRAR_ROLE) {
        if (memberIdHash == bytes32(0)) revert EmptyIdentifier();
        if (_members[account].exists) revert AlreadyEnrolled(account);

        address holder = _idHashToAddress[memberIdHash];
        if (holder != address(0)) revert IdentifierAlreadyUsed(memberIdHash, holder);

        _members[account] =
            Member({memberIdHash: memberIdHash, enrolledAt: uint64(block.timestamp), active: true, exists: true});
        _idHashToAddress[memberIdHash] = account;
        _roster.push(account);
        _activeCount += 1;

        emit MemberEnrolled(account, memberIdHash, uint64(block.timestamp));
    }

    /// @notice Add a batch of wallets in one transaction.
    function enrolBatch(address[] calldata accounts, bytes32[] calldata memberIdHashes)
        external
        onlyRole(REGISTRAR_ROLE)
    {
        if (accounts.length != memberIdHashes.length) revert LengthMismatch();
        for (uint256 i = 0; i < accounts.length; i++) {
            enrol(accounts[i], memberIdHashes[i]);
        }
    }

    /// @notice Suspend a member. Past votes stay on the ledger; future ones are refused.
    function suspend(address account) external onlyRole(REGISTRAR_ROLE) {
        Member storage m = _members[account];
        if (!m.exists) revert NotEnrolled(account);
        if (!m.active) revert AlreadySuspended(account);

        m.active = false;
        _activeCount -= 1;

        emit MemberSuspended(account, m.memberIdHash);
    }

    /// @notice Restore a suspended member.
    function reinstate(address account) external onlyRole(REGISTRAR_ROLE) {
        Member storage m = _members[account];
        if (!m.exists) revert NotEnrolled(account);
        if (m.active) revert AlreadyActive(account);

        m.active = true;
        _activeCount += 1;

        emit MemberReinstated(account, m.memberIdHash);
    }

    // --- views -------------------------------------------------------------

    function isActiveMember(address account) external view returns (bool) {
        return _members[account].active;
    }

    function memberOf(address account) external view returns (Member memory) {
        return _members[account];
    }

    function addressOfIdentifier(bytes32 memberIdHash) external view returns (address) {
        return _idHashToAddress[memberIdHash];
    }

    function activeMemberCount() external view returns (uint256) {
        return _activeCount;
    }

    function rosterLength() external view returns (uint256) {
        return _roster.length;
    }

    function rosterAt(uint256 index) external view returns (address) {
        return _roster[index];
    }

    function roster() external view returns (address[] memory) {
        return _roster;
    }
}
