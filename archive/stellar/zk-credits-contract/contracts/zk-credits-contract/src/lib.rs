#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bls12_381::{Bls12381Fr, Bls12381G1Affine, Bls12381G2Affine},
    token, Address, Env, Map, Symbol, U256, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    DepositsFull = 3,
    DepositNotFound = 4,
    AlreadySlashed = 5,
    AlreadyWithdrawn = 6,
    NullifierAlreadySpent = 7,
    InvalidProof = 8,
    MalformedVerifyingKey = 9,
    InsufficientBalance = 10,
    CommitmentMismatch = 11,
    RootMismatch = 12,
    AmountMustBePositive = 13,
    DuplicateCommitment = 14,
    Unauthorized = 15,
}

#[contracttype]
#[derive(Clone)]
pub struct Deposit {
    pub amount: i128,
    pub depositor: Address,
    pub commitment: Bls12381Fr,
    pub slashed: bool,
    pub withdrawn: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct NullifierRecord {
    pub epoch: u64,
    pub spent_at_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: Bls12381G1Affine,
    pub beta: Bls12381G2Affine,
    pub gamma: Bls12381G2Affine,
    pub delta: Bls12381G2Affine,
    pub ic: Vec<Bls12381G1Affine>,
}

#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub a: Bls12381G1Affine,
    pub b: Bls12381G2Affine,
    pub c: Bls12381G1Affine,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Treasury,
    CurrentRoot,
    RootHistory,
    DepositCount,
    Deposits,
    Nullifiers,
    /// VK for the indexed-ticket spend statement [root, nullifier, x, y].
    SpendVerifyingKey,
    /// VK for the two-share slash statement.
    SlashVerifyingKey,
    /// Reserved for a future membership-only statement. Keeping it separate
    /// prevents a deposit VK from being accidentally used as a spend VK.
    MembershipVerifyingKey,
    /// The constructor accepts one spend VK for ABI compatibility; the admin
    /// may install the two remaining dedicated statement keys exactly once.
    StatementKeysInstalled,
    UsdcContract,
}

fn fr_zero(env: &Env) -> Bls12381Fr {
    Bls12381Fr::from_u256(U256::from_u32(env, 0))
}

#[contract]
pub struct ZkCreditsContract;

#[contractimpl]
impl ZkCreditsContract {
    pub fn __constructor(
        env: Env,
        admin: Address,
        treasury: Address,
        vk: VerificationKey,
        usdc_contract: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("AlreadyInitialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        // The constructor keeps the existing deployment ABI while placing
        // each statement under its own storage key. Production deployments
        // should immediately replace the slash/membership keys with their
        // dedicated VKs through set_statement_verifying_keys().
        env.storage().instance().set(&DataKey::SpendVerifyingKey, &vk);
        env.storage().instance().set(&DataKey::SlashVerifyingKey, &vk);
        env.storage().instance().set(&DataKey::MembershipVerifyingKey, &vk);
        env.storage()
            .instance()
            .set(&DataKey::StatementKeysInstalled, &false);
        env.storage().instance().set(&DataKey::UsdcContract, &usdc_contract);
        env.storage().instance().set(&DataKey::DepositCount, &0u32);
        env.storage().instance().set(&DataKey::CurrentRoot, &fr_zero(&env));
    }

    pub fn set_statement_verifying_keys(
        env: Env,
        spend_vk: VerificationKey,
        slash_vk: VerificationKey,
        membership_vk: VerificationKey,
    ) -> Result<(), ContractError> {
        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        admin.require_auth();
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::StatementKeysInstalled)
            .unwrap_or(false)
        {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::SpendVerifyingKey, &spend_vk);
        env.storage().instance().set(&DataKey::SlashVerifyingKey, &slash_vk);
        env.storage().instance().set(&DataKey::MembershipVerifyingKey, &membership_vk);
        env.storage()
            .instance()
            .set(&DataKey::StatementKeysInstalled, &true);
        Ok(())
    }

    pub fn deposit(
        env: Env,
        depositor: Address,
        commitment: Bls12381Fr,
        new_root: Bls12381Fr,
        amount: i128,
    ) -> Result<(), ContractError> {
        depositor.require_auth();

        if amount <= 0 {
            return Err(ContractError::AmountMustBePositive);
        }

        // Prevent duplicate commitments
        let deposits: Map<Bls12381Fr, Deposit> = env.storage().instance().get(&DataKey::Deposits).unwrap_or(Map::new(&env));
        if deposits.contains_key(commitment.clone()) {
            return Err(ContractError::DuplicateCommitment);
        }

        let count: u32 = env.storage().instance().get(&DataKey::DepositCount).unwrap_or(0);
        let usdc: Address = env.storage().instance().get(&DataKey::UsdcContract).unwrap();
        token::Client::new(&env, &usdc).transfer(&depositor, &env.current_contract_address(), &amount);

        let mut updated_deposits = deposits;
        updated_deposits.set(commitment.clone(), Deposit {
            amount,
            depositor: depositor.clone(),
            commitment: commitment.clone(),
            slashed: false,
            withdrawn: false,
        });
        env.storage().instance().set(&DataKey::Deposits, &updated_deposits);
        env.storage().instance().set(&DataKey::DepositCount, &(count + 1));

        // Store root history and update current root
        // new_root is the Merkle root computed off-chain by the caller's wallet
        // The circuit (deposit_membership) proves the commitment is a leaf in the tree
        // with this root. spend() verifies proofs against the stored root.
        let old_root: Bls12381Fr = env.storage().instance().get(&DataKey::CurrentRoot).unwrap_or(fr_zero(&env));
        let mut roots: Map<u32, Bls12381Fr> = env.storage().instance().get(&DataKey::RootHistory).unwrap_or(Map::new(&env));
        roots.set(count, old_root);
        env.storage().instance().set(&DataKey::RootHistory, &roots);
        env.storage().instance().set(&DataKey::CurrentRoot, &new_root);

        env.events().publish((Symbol::new(&env, "Deposited"),), (commitment, depositor, amount, count + 1));
        env.storage().instance().extend_ttl(100, 518400);
        Ok(())
    }

    pub fn spend(
        env: Env,
        proof: Groth16Proof,
        pub_signals: Vec<Bls12381Fr>,
    ) -> Result<(), ContractError> {
        // Indexed-ticket public signal layout: [root, nullifier, share_x,
        // share_y]. There is deliberately no epoch signal: ticket_index is a
        // private one-time slot inside the fixed Starter package.
        if pub_signals.len() != 4 {
            return Err(ContractError::InvalidProof);
        }
        let spend_vk: VerificationKey = env.storage().instance().get(&DataKey::SpendVerifyingKey)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::verify_groth16(&env, &spend_vk, proof, pub_signals.clone())? {
            return Err(ContractError::InvalidProof);
        }

        let proof_root = pub_signals.get(0).ok_or(ContractError::InvalidProof)?;
        if !Self::is_valid_root(&env, &proof_root) {
            return Err(ContractError::RootMismatch);
        }

        let nullifier = pub_signals.get(1).ok_or(ContractError::InvalidProof)?;
        let mut nullifiers: Map<Bls12381Fr, NullifierRecord> = env.storage().instance().get(&DataKey::Nullifiers).unwrap_or(Map::new(&env));

        if nullifiers.contains_key(nullifier.clone()) {
            return Err(ContractError::NullifierAlreadySpent);
        }

        nullifiers.set(nullifier.clone(), NullifierRecord {
            epoch: 0,
            spent_at_ledger: env.ledger().sequence(),
        });
        env.storage().instance().set(&DataKey::Nullifiers, &nullifiers);

        env.events().publish((Symbol::new(&env, "NullifierSpent"),), (nullifier, env.ledger().sequence()));
        env.storage().instance().extend_ttl(100, 518400);
        Ok(())
    }

    pub fn slash(
        env: Env,
        slash_proof: Groth16Proof,
        pub_signals: Vec<Bls12381Fr>,
        commitment: Bls12381Fr,
        submitter: Address,
    ) -> Result<(), ContractError> {
        // Slash circuit public signals (Circom output order):
        // [extracted_secret_k, computed_commitment, computed_nullifier,
        //  current_root, next_root, share1_x, share1_y, share2_x, share2_y].
        // The root transition is part of the proof statement: accepting a
        // slash must revoke the offending commitment, not merely flag its
        // deposit while leaving the old membership root spendable forever.
        if pub_signals.len() != 9 {
            return Err(ContractError::InvalidProof);
        }
        let slash_vk: VerificationKey = env.storage().instance().get(&DataKey::SlashVerifyingKey)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::verify_groth16(&env, &slash_vk, slash_proof, pub_signals.clone())? {
            return Err(ContractError::InvalidProof);
        }

        let extracted_secret_k = pub_signals.get(0).ok_or(ContractError::InvalidProof)?;
        let computed_commitment = pub_signals.get(1).ok_or(ContractError::InvalidProof)?;
        let proof_root = pub_signals.get(3).ok_or(ContractError::InvalidProof)?;
        let next_root = pub_signals.get(4).ok_or(ContractError::InvalidProof)?;

        if !Self::is_valid_root(&env, &proof_root) || proof_root == next_root {
            return Err(ContractError::RootMismatch);
        }
        let mut deposits: Map<Bls12381Fr, Deposit> = env.storage().instance().get(&DataKey::Deposits).unwrap_or(Map::new(&env));

        // Verify that the proof's computed commitment (MiMC(extracted_secret_k))
        // matches the deposit commitment. This binds the slash proof to the specific deposit.
        if computed_commitment != commitment {
            return Err(ContractError::CommitmentMismatch);
        }

        let mut deposit = deposits.get(commitment.clone()).ok_or(ContractError::DepositNotFound)?;

        if deposit.slashed {
            return Err(ContractError::AlreadySlashed);
        }
        if deposit.withdrawn {
            return Err(ContractError::AlreadyWithdrawn);
        }

        deposit.slashed = true;
        let slashed_amount = deposit.amount;

        let mut updated = deposits;
        updated.set(commitment.clone(), deposit);
        env.storage().instance().set(&DataKey::Deposits, &updated);

        // A removal transition invalidates every grace root. The current
        // storage does not retain a per-root leaf set, so retaining any
        // historical root could keep the removed member authorized. Additive
        // deposits may re-create a bounded grace window; removals always
        // revoke it atomically.
        env.storage().instance().set(&DataKey::CurrentRoot, &next_root);
        env.storage().instance().set(
            &DataKey::RootHistory,
            &Map::<u32, Bls12381Fr>::new(&env),
        );

        let half = slashed_amount / 2;
        let remainder = slashed_amount - half;
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        let usdc: Address = env.storage().instance().get(&DataKey::UsdcContract).unwrap();
        let token_client = token::Client::new(&env, &usdc);

        if half > 0 {
            token_client.transfer(&env.current_contract_address(), &treasury, &half);
        }
        if remainder > 0 {
            token_client.transfer(&env.current_contract_address(), &submitter, &remainder);
        }

        env.events().publish((Symbol::new(&env, "Slashed"),), (commitment, extracted_secret_k, slashed_amount));
        env.storage().instance().extend_ttl(100, 518400);
        Ok(())
    }

    pub fn withdraw(
        env: Env,
        withdrawal_proof: Groth16Proof,
        pub_signals: Vec<Bls12381Fr>,
        commitment: Bls12381Fr,
        recipient: Address,
    ) -> Result<(), ContractError> {
        // Membership-removal public signal layout: [commitment, current_root,
        // next_root]. The proof keeps the secret and Merkle path private while
        // proving the exact removal transition that the contract commits.
        if pub_signals.len() != 3 {
            return Err(ContractError::InvalidProof);
        }
        let membership_vk: VerificationKey = env.storage().instance().get(&DataKey::MembershipVerifyingKey)
            .ok_or(ContractError::NotInitialized)?;
        if !Self::verify_groth16(&env, &membership_vk, withdrawal_proof, pub_signals.clone())? {
            return Err(ContractError::InvalidProof);
        }

        let proven_commitment = pub_signals.get(0).ok_or(ContractError::InvalidProof)?;
        let proof_root = pub_signals.get(1).ok_or(ContractError::InvalidProof)?;
        let next_root = pub_signals.get(2).ok_or(ContractError::InvalidProof)?;
        if proven_commitment != commitment {
            return Err(ContractError::CommitmentMismatch);
        }
        if !Self::is_valid_root(&env, &proof_root) || proof_root == next_root {
            return Err(ContractError::RootMismatch);
        }

        let mut deposits: Map<Bls12381Fr, Deposit> = env.storage().instance().get(&DataKey::Deposits).unwrap_or(Map::new(&env));
        let deposit = deposits.get(commitment.clone()).ok_or(ContractError::DepositNotFound)?;

        // The gateway remains the fee-sponsored depositor for this testnet
        // launch, but it can only co-sign a withdrawal that includes a valid
        // browser-secret membership-removal proof.
        deposit.depositor.require_auth();

        if deposit.slashed {
            return Err(ContractError::AlreadySlashed);
        }
        if deposit.withdrawn {
            return Err(ContractError::AlreadyWithdrawn);
        }

        let amount = deposit.amount;
        let mut updated_deposit = deposit;
        updated_deposit.withdrawn = true;
        deposits.set(commitment.clone(), updated_deposit);
        env.storage().instance().set(&DataKey::Deposits, &deposits);

        // As with slash(), revoke every grace root atomically so this
        // commitment cannot keep authorizing spends through historical roots.
        env.storage().instance().set(&DataKey::CurrentRoot, &next_root);
        env.storage().instance().set(
            &DataKey::RootHistory,
            &Map::<u32, Bls12381Fr>::new(&env),
        );

        let usdc: Address = env.storage().instance().get(&DataKey::UsdcContract).unwrap();
        token::Client::new(&env, &usdc).transfer(&env.current_contract_address(), &recipient, &amount);

        env.events().publish((Symbol::new(&env, "Withdrawn"),), (commitment, recipient, amount));
        env.storage().instance().extend_ttl(100, 518400);
        Ok(())
    }

    // ─── Read functions ──────────────────────────────────────────

    pub fn get_deposit(env: Env, commitment: Bls12381Fr) -> Option<Deposit> {
        let deposits: Map<Bls12381Fr, Deposit> = env.storage().instance().get(&DataKey::Deposits).unwrap_or(Map::new(&env));
        deposits.get(commitment)
    }

    pub fn is_nullifier_spent(env: Env, nullifier: Bls12381Fr) -> bool {
        let nullifiers: Map<Bls12381Fr, NullifierRecord> = env.storage().instance().get(&DataKey::Nullifiers).unwrap_or(Map::new(&env));
        nullifiers.contains_key(nullifier)
    }

    pub fn get_current_root(env: Env) -> Bls12381Fr {
        env.storage().instance().get(&DataKey::CurrentRoot).unwrap_or(fr_zero(&env))
    }

    pub fn get_deposit_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::DepositCount).unwrap_or(0)
    }

    // ─── Root validation ─────────────────────────────────────────

    fn is_valid_root(env: &Env, root: &Bls12381Fr) -> bool {
        let current: Bls12381Fr = env.storage().instance().get(&DataKey::CurrentRoot).unwrap_or(fr_zero(env));
        if *root == current {
            return true;
        }
        let history: Map<u32, Bls12381Fr> = env.storage().instance().get(&DataKey::RootHistory).unwrap_or(Map::new(env));
        for (_, historical_root) in history.iter() {
            if *root == historical_root {
                return true;
            }
        }
        false
    }

    // ─── Groth16 Verifier (CAP-0059) ─────────────────────────────

    fn verify_groth16(
        env: &Env,
        vk: &VerificationKey,
        proof: Groth16Proof,
        pub_signals: Vec<Bls12381Fr>,
    ) -> Result<bool, ContractError> {
        let bls = env.crypto().bls12_381();

        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(ContractError::MalformedVerifyingKey);
        }

        let mut vk_x = vk.ic.get(0).unwrap();
        for i in 0..pub_signals.len() {
            let s = pub_signals.get(i).unwrap();
            let ic_elem = vk.ic.get(i + 1).unwrap();
            let prod = bls.g1_mul(&ic_elem, &s);
            vk_x = bls.g1_add(&vk_x, &prod);
        }

        let neg_a = -proof.a;
        let vp1 = Vec::from_array(&env, [neg_a, vk.alpha.clone(), vk_x, proof.c]);
        let vp2 = Vec::from_array(&env, [proof.b, vk.beta.clone(), vk.gamma.clone(), vk.delta.clone()]);

        Ok(bls.pairing_check(vp1, vp2))
    }
}

mod test;
