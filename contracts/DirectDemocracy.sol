// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {MemberRegistry} from "./MemberRegistry.sol";

/**
 * @title DirectDemocracy
 * @notice Proposal registry, vote log and tally for a single organisation.
 *
 * The contract holds three things the paper design calls for: a registry of
 * open questions, an append-only record of who voted on what, and a tally that
 * anybody can recompute from the same data. Eligibility is delegated to a
 * MemberRegistry, so identity and voting stay separable.
 *
 * One address casts one vote per proposal. The check is a storage flag, not a
 * balance, so nothing about this design rewards holding more of anything.
 */
contract DirectDemocracy is AccessControl {
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");

    enum State {
        Pending, // created, voting has not opened
        Active, // inside the voting window
        Closed, // window has passed, not yet tallied
        Finalised // tallied and published on chain
    }

    struct Proposal {
        string title;
        string description;
        string[] options;
        uint64 opensAt;
        uint64 closesAt;
        uint16 quorumBps; // required turnout, in basis points of the electorate
        uint32 electorate; // active members at the moment of creation
        address proposer;
        uint64 createdAt;
        bool cancelled;
        bool finalised;
        bool quorumMet;
        bool tied;
        uint32 winningOption;
        uint32 totalVotes;
    }

    struct Receipt {
        bool voted;
        uint32 option;
        uint64 blockNumber;
    }

    /// @dev Header data, split from options/tallies so structs stay ABI-friendly.
    struct ProposalView {
        uint256 id;
        string title;
        string description;
        string[] options;
        uint256[] tally;
        uint64 opensAt;
        uint64 closesAt;
        uint16 quorumBps;
        uint32 electorate;
        address proposer;
        uint64 createdAt;
        bool cancelled;
        bool finalised;
        bool quorumMet;
        bool tied;
        uint32 winningOption;
        uint32 totalVotes;
        State state;
    }

    MemberRegistry public immutable registry;

    Proposal[] private _proposals;
    mapping(uint256 => mapping(uint256 => uint256)) private _tally; // proposalId => option => count
    mapping(uint256 => mapping(address => Receipt)) private _receipts;

    uint16 public constant MAX_BPS = 10_000;
    uint256 public constant MIN_OPTIONS = 2;
    uint256 public constant MAX_OPTIONS = 16;

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string title,
        uint64 opensAt,
        uint64 closesAt,
        uint16 quorumBps,
        uint32 electorate
    );
    event VoteCast(uint256 indexed proposalId, address indexed voter, uint32 indexed option, uint64 blockNumber);
    event ProposalCancelled(uint256 indexed proposalId, address indexed by);
    event ProposalFinalised(
        uint256 indexed proposalId, uint32 winningOption, uint32 totalVotes, bool quorumMet, bool tied
    );

    error UnknownProposal(uint256 proposalId);
    error NotAMember(address account);
    error VotingNotOpen(uint256 proposalId, State state);
    error AlreadyVoted(uint256 proposalId, address voter);
    error UnknownOption(uint256 proposalId, uint32 option);
    error WindowInPast(uint64 opensAt, uint64 closesAt);
    error WindowInverted(uint64 opensAt, uint64 closesAt);
    error BadOptionCount(uint256 given);
    error EmptyTitle();
    error QuorumTooHigh(uint16 quorumBps);
    error NoElectorate();
    error VotingStillOpen(uint256 proposalId, uint64 closesAt);
    error AlreadyFinalised(uint256 proposalId);
    error ProposalIsCancelled(uint256 proposalId);
    error CannotCancelNow(uint256 proposalId, State state);
    error NoReceipt(uint256 proposalId, address voter);

    constructor(MemberRegistry registry_, address admin) {
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, admin);
    }

    // --- step 1: an officer opens a question -------------------------------

    /**
     * @notice Register a proposal and fix its voting window.
     * @param quorumBps Share of the electorate that must vote for the result to
     *                  count, in basis points (2500 = 25%).
     * @return proposalId Index of the new proposal.
     */
    function createProposal(
        string calldata title,
        string calldata description,
        string[] calldata options,
        uint64 opensAt,
        uint64 closesAt,
        uint16 quorumBps
    ) external onlyRole(PROPOSER_ROLE) returns (uint256 proposalId) {
        if (bytes(title).length == 0) revert EmptyTitle();
        if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) revert BadOptionCount(options.length);
        if (closesAt <= opensAt) revert WindowInverted(opensAt, closesAt);
        if (closesAt <= block.timestamp) revert WindowInPast(opensAt, closesAt);
        if (quorumBps > MAX_BPS) revert QuorumTooHigh(quorumBps);

        uint256 electorate = registry.activeMemberCount();
        if (electorate == 0) revert NoElectorate();

        proposalId = _proposals.length;
        Proposal storage p = _proposals.push();
        p.title = title;
        p.description = description;
        p.opensAt = opensAt;
        p.closesAt = closesAt;
        p.quorumBps = quorumBps;
        p.electorate = uint32(electorate);
        p.proposer = msg.sender;
        p.createdAt = uint64(block.timestamp);
        for (uint256 i = 0; i < options.length; i++) {
            p.options.push(options[i]);
        }

        emit ProposalCreated(proposalId, msg.sender, title, opensAt, closesAt, quorumBps, uint32(electorate));
    }

    /// @notice Withdraw a proposal before voting opens.
    function cancelProposal(uint256 proposalId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Proposal storage p = _proposal(proposalId);
        State s = _state(p);
        if (s != State.Pending) revert CannotCancelNow(proposalId, s);

        p.cancelled = true;
        emit ProposalCancelled(proposalId, msg.sender);
    }

    // --- steps 4 and 5: a member votes, the contract checks -----------------

    /**
     * @notice Cast one vote on an open proposal.
     * @dev Three checks, in the order the design document lists them: is the
     *      proposal open, is the caller an active member, has the caller
     *      already been counted.
     */
    function castVote(uint256 proposalId, uint32 option) external {
        Proposal storage p = _proposal(proposalId);

        State s = _state(p);
        if (s != State.Active) revert VotingNotOpen(proposalId, s);
        if (!registry.isActiveMember(msg.sender)) revert NotAMember(msg.sender);
        if (_receipts[proposalId][msg.sender].voted) revert AlreadyVoted(proposalId, msg.sender);
        if (option >= p.options.length) revert UnknownOption(proposalId, option);

        _receipts[proposalId][msg.sender] =
            Receipt({voted: true, option: option, blockNumber: uint64(block.number)});
        _tally[proposalId][option] += 1;
        p.totalVotes += 1;

        emit VoteCast(proposalId, msg.sender, option, uint64(block.number));
    }

    // --- step 8: the tally is published on chain ---------------------------

    /**
     * @notice Tally a closed proposal and write the outcome to the ledger.
     * @dev Deliberately open to any caller. The result is a pure function of
     *      data already on chain, so letting only an officer trigger it would
     *      add a gatekeeper without adding a safeguard.
     */
    function finaliseProposal(uint256 proposalId) external {
        Proposal storage p = _proposal(proposalId);
        if (p.cancelled) revert ProposalIsCancelled(proposalId);
        if (p.finalised) revert AlreadyFinalised(proposalId);
        if (block.timestamp < p.closesAt) revert VotingStillOpen(proposalId, p.closesAt);

        uint256 leader = 0;
        uint256 leadingCount = 0;
        bool tied = false;

        for (uint256 i = 0; i < p.options.length; i++) {
            uint256 count = _tally[proposalId][i];
            if (count > leadingCount) {
                leadingCount = count;
                leader = i;
                tied = false;
            } else if (count == leadingCount && i != 0) {
                tied = true;
            }
        }

        bool quorumMet = p.totalVotes > 0 && uint256(p.totalVotes) * MAX_BPS >= uint256(p.electorate) * p.quorumBps;

        p.finalised = true;
        p.quorumMet = quorumMet;
        p.tied = p.totalVotes == 0 ? true : tied;
        p.winningOption = uint32(leader);

        emit ProposalFinalised(proposalId, uint32(leader), p.totalVotes, quorumMet, p.tied);
    }

    // --- views: anything the dashboard or an auditor needs ------------------

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function stateOf(uint256 proposalId) external view returns (State) {
        return _state(_proposal(proposalId));
    }

    function tallyOf(uint256 proposalId) public view returns (uint256[] memory counts) {
        Proposal storage p = _proposal(proposalId);
        counts = new uint256[](p.options.length);
        for (uint256 i = 0; i < p.options.length; i++) {
            counts[i] = _tally[proposalId][i];
        }
    }

    function receiptOf(uint256 proposalId, address voter) external view returns (Receipt memory) {
        _proposal(proposalId);
        return _receipts[proposalId][voter];
    }

    /// @notice Digest a member can keep and re-derive to prove how they were recorded.
    function receiptHash(uint256 proposalId, address voter) external view returns (bytes32) {
        Receipt memory r = _receipts[proposalId][voter];
        if (!r.voted) revert NoReceipt(proposalId, voter);
        return keccak256(abi.encodePacked(address(this), block.chainid, proposalId, voter, r.option, r.blockNumber));
    }

    function getProposal(uint256 proposalId) public view returns (ProposalView memory view_) {
        Proposal storage p = _proposal(proposalId);
        view_ = ProposalView({
            id: proposalId,
            title: p.title,
            description: p.description,
            options: p.options,
            tally: tallyOf(proposalId),
            opensAt: p.opensAt,
            closesAt: p.closesAt,
            quorumBps: p.quorumBps,
            electorate: p.electorate,
            proposer: p.proposer,
            createdAt: p.createdAt,
            cancelled: p.cancelled,
            finalised: p.finalised,
            quorumMet: p.quorumMet,
            tied: p.tied,
            winningOption: p.winningOption,
            totalVotes: p.totalVotes,
            state: _state(p)
        });
    }

    /// @notice Page through proposals newest-first for the dashboard.
    function listProposals(uint256 offset, uint256 limit) external view returns (ProposalView[] memory page) {
        uint256 total = _proposals.length;
        if (offset >= total) return new ProposalView[](0);

        uint256 size = total - offset;
        if (size > limit) size = limit;

        page = new ProposalView[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = getProposal(total - 1 - offset - i);
        }
    }

    // --- internals ---------------------------------------------------------

    function _proposal(uint256 proposalId) private view returns (Proposal storage) {
        if (proposalId >= _proposals.length) revert UnknownProposal(proposalId);
        return _proposals[proposalId];
    }

    function _state(Proposal storage p) private view returns (State) {
        if (p.finalised) return State.Finalised;
        if (p.cancelled) return State.Closed;
        if (block.timestamp < p.opensAt) return State.Pending;
        if (block.timestamp < p.closesAt) return State.Active;
        return State.Closed;
    }
}
