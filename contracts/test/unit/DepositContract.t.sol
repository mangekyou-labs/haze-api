// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {DepositContract} from "../../src/DepositContract.sol";
import {Test} from "forge-std/Test.sol";

contract DepositContractTest is Test {
    DepositContract public depositContract;

    event Deposited(bytes32 indexed commitment, uint256 amount, address depositor);
    event NullifierSpent(bytes32 indexed nullifier);

    address public constant ALICE = address(0x1);
    address public constant BOB = address(0x2);

    function setUp() public {
        depositContract = new DepositContract();
        // Fund test accounts
        vm.deal(ALICE, 100 ether);
        vm.deal(BOB, 100 ether);
    }

    // ═══════════════════════════════════════════════════════
    // deposit()
    // ═══════════════════════════════════════════════════════

    function test_deposit_storesDepositData() external payable {
        bytes32 commitment = keccak256("test_commitment");
        uint256 amount = 1 ether;

        vm.prank(ALICE);
        depositContract.deposit{value: amount}(commitment);

        (uint256 storedAmount, address depositor,, bool withdrawn) = depositContract.commitments(commitment);
        assertEq(storedAmount, amount);
        assertEq(depositor, ALICE);
        assertFalse(withdrawn);
    }

    function test_deposit_revertIfZeroValue() external {
        bytes32 commitment = keccak256("test_commitment");

        vm.prank(ALICE);
        vm.expectRevert(DepositContract.MustSendETH.selector);
        depositContract.deposit{value: 0}(commitment);
    }

    function test_deposit_revertIfZeroCommitment() external {
        vm.prank(ALICE);
        vm.expectRevert(DepositContract.CommitmentCannotBeZero.selector);
        depositContract.deposit{value: 1 ether}(bytes32(0));
    }

    function test_deposit_incrementsLeafCount() external payable {
        bytes32 commitment = keccak256("test_commitment_1");

        vm.prank(ALICE);
        depositContract.deposit{value: 1 ether}(commitment);

        assertEq(depositContract.leafCount(), 1);
    }

    function test_deposit_multipleDepositsIncrementLeafCount() external payable {
        bytes32 c1 = keccak256("commitment_1");
        bytes32 c2 = keccak256("commitment_2");

        vm.prank(ALICE);
        depositContract.deposit{value: 1 ether}(c1);
        assertEq(depositContract.leafCount(), 1);

        vm.prank(ALICE);
        depositContract.deposit{value: 1 ether}(c2);
        assertEq(depositContract.leafCount(), 2);
    }

    function test_deposit_updatesCurrentRoot() external payable {
        bytes32 commitment = keccak256("test_commitment");

        vm.prank(ALICE);
        depositContract.deposit{value: 1 ether}(commitment);

        assertTrue(depositContract.currentRoot() != bytes32(0));
    }

    // ═══════════════════════════════════════════════════════
    // withdraw()
    // ═══════════════════════════════════════════════════════

    function test_withdraw_transfersToRecipient() external payable {
        bytes32 commitment = keccak256("test_commitment");
        uint256 amount = 1 ether;

        vm.prank(ALICE);
        depositContract.deposit{value: amount}(commitment);

        uint256 recipientBalanceBefore = BOB.balance;

        vm.prank(ALICE);
        depositContract.withdraw(commitment, BOB);

        assertEq(BOB.balance, recipientBalanceBefore + amount);
    }

    function test_withdraw_marksAsWithdrawn() external payable {
        bytes32 commitment = keccak256("test_commitment");

        vm.prank(ALICE);
        depositContract.deposit{value: 1 ether}(commitment);

        vm.prank(ALICE);
        depositContract.withdraw(commitment, BOB);

        (,,, bool withdrawn) = depositContract.commitments(commitment);
        assertTrue(withdrawn);
    }

    function test_withdraw_revertIfAlreadyWithdrawn() external payable {
        bytes32 commitment = keccak256("test_commitment");

        vm.prank(ALICE);
        depositContract.deposit{value: 1 ether}(commitment);

        vm.prank(ALICE);
        depositContract.withdraw(commitment, BOB);

        vm.prank(ALICE);
        vm.expectRevert(DepositContract.AlreadyWithdrawn.selector);
        depositContract.withdraw(commitment, BOB);
    }

    function test_withdraw_revertIfNotDepositor() external payable {
        bytes32 commitment = keccak256("test_commitment");

        vm.prank(ALICE);
        depositContract.deposit{value: 1 ether}(commitment);

        vm.prank(BOB);
        vm.expectRevert(DepositContract.NotDepositor.selector);
        depositContract.withdraw(commitment, BOB);
    }

    // ═══════════════════════════════════════════════════════
    // Edge cases
    // ═══════════════════════════════════════════════════════

    function test_deposit_selfWithdraw() external payable {
        bytes32 commitment = keccak256("test_commitment");

        vm.prank(ALICE);
        depositContract.deposit{value: 1 ether}(commitment);

        uint256 aliceBalanceBefore = ALICE.balance;

        vm.prank(ALICE);
        depositContract.withdraw(commitment, ALICE);

        assertEq(ALICE.balance, aliceBalanceBefore + 1 ether);
    }
}
