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
    VerifyingKey,
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
        env.storage().instance().set(&DataKey::VerifyingKey, &vk);
        env.storage().instance().set(&DataKey::UsdcContract, &usdc_contract);
        env.storage().instance().set(&DataKey::DepositCount, &0u32);
        env.storage().instance().set(&DataKey::CurrentRoot, &fr_zero(&env));
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
        if !Self::verify_groth16(&env, proof, pub_signals.clone())? {
            return Err(ContractError::InvalidProof);
        }

        // pub_signals layout for rln_nullifier: [root, nullifier, share_x, share_y, epoch]
        if pub_signals.len() < 5 {
            return Err(ContractError::InvalidProof);
        }
        let proof_root = pub_signals.get(0).ok_or(ContractError::InvalidProof)?;
        if !Self::is_valid_root(&env, &proof_root) {
            return Err(ContractError::RootMismatch);
        }

        let nullifier = pub_signals.get(1).ok_or(ContractError::InvalidProof)?;
        let epoch_fr = pub_signals.get(4).ok_or(ContractError::InvalidProof)?;
        let mut nullifiers: Map<Bls12381Fr, NullifierRecord> = env.storage().instance().get(&DataKey::Nullifiers).unwrap_or(Map::new(&env));

        if nullifiers.contains_key(nullifier.clone()) {
            return Err(ContractError::NullifierAlreadySpent);
        }

        // Convert epoch (Fr) to u64. Epoch is typically a UTC day number
        // or sequential counter — always fits in u64.
        let epoch_u128 = epoch_fr.to_u256().to_u128().ok_or(ContractError::InvalidProof)?;
        let epoch = epoch_u128 as u64;

        nullifiers.set(nullifier.clone(), NullifierRecord {
            epoch,
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
        if !Self::verify_groth16(&env, slash_proof, pub_signals.clone())? {
            return Err(ContractError::InvalidProof);
        }

        // Slash circuit public signals (Circom output order):
        // [extracted_secret_k, computed_commitment, share1_x, share1_y, share2_x, share2_y, epoch]
        if pub_signals.len() < 7 {
            return Err(ContractError::InvalidProof);
        }
        let extracted_secret_k = pub_signals.get(0).ok_or(ContractError::InvalidProof)?;
        let computed_commitment = pub_signals.get(1).ok_or(ContractError::InvalidProof)?;
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

    pub fn withdraw(env: Env, commitment: Bls12381Fr, recipient: Address) -> Result<(), ContractError> {
        let mut deposits: Map<Bls12381Fr, Deposit> = env.storage().instance().get(&DataKey::Deposits).unwrap_or(Map::new(&env));
        let deposit = deposits.get(commitment.clone()).ok_or(ContractError::DepositNotFound)?;

        // NOTE (v1 custodial limitation): In the custodial model, the gateway creates
        // deposits on behalf of users, so `depositor` = gateway account. The user who
        // holds `secret_k` cannot authorize withdrawal via this auth check alone.
        // The design doc specifies withdrawal should require a ZK proof of `secret_k`
        // ownership (deposit_membership proof). This is deferred to M8 E2E integration.
        // For v1, only the gateway (depositor) can trigger withdrawal.
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
        proof: Groth16Proof,
        pub_signals: Vec<Bls12381Fr>,
    ) -> Result<bool, ContractError> {
        let vk: VerificationKey = env.storage().instance().get(&DataKey::VerifyingKey)
            .ok_or(ContractError::NotInitialized)?;
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
        let vp1 = Vec::from_array(&env, [neg_a, vk.alpha, vk_x, proof.c]);
        let vp2 = Vec::from_array(&env, [proof.b, vk.beta, vk.gamma, vk.delta]);

        Ok(bls.pairing_check(vp1, vp2))
    }
}

mod test;
