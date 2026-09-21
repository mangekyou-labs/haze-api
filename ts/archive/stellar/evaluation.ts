import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

export const EVALUATION_CONSENT_VERSION = 'level4-2026-09-11';
export const SEP53_PREFIX = 'Stellar Signed Message:\n';
export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const RETENTION_DAYS = 90;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const EVALUATION_CHECKOUT_AMOUNT_CENTS = 100;
export const CHECKOUT_PROCESSING_LEASE_MS = 5 * 60 * 1000;

const WALLET_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;
const TRANSACTION_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const BASE64_SIGNATURE_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_FEEDBACK_TEXT_LENGTH = 1_000;
const CHALLENGE_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_CHALLENGES_PER_WINDOW = 5;

function isCheckoutProcessingStatus(value: unknown): value is CheckoutProcessingStatus {
  return value === 'pending' || value === 'processing' || value === 'confirmed' || value === 'failed';
}

export type EvaluationErrorCode =
  | 'invalid_secret'
  | 'invalid_subject'
  | 'not_enrolled'
  | 'already_enrolled'
  | 'invalid_consent_version'
  | 'rate_limited'
  | 'challenge_not_found'
  | 'challenge_replayed'
  | 'challenge_expired'
  | 'wallet_proof_invalid'
  | 'wallet_already_used'
  | 'wallet_not_verified'
  | 'invalid_transaction_hash'
  | 'deposit_already_used'
  | 'deposit_not_found'
  | 'checkout_invalid'
  | 'checkout_already_used'
  | 'checkout_not_found'
  | 'feedback_not_ready'
  | 'invalid_ease_rating'
  | 'invalid_task_completed'
  | 'invalid_would_use_again'
  | 'invalid_feedback_text'
  | 'invalid_quote_consent'
  | 'minimum_participants';

export class EvaluationError extends Error {
  readonly code: EvaluationErrorCode;

  constructor(code: EvaluationErrorCode, message: string = code) {
    super(message);
    this.name = 'EvaluationError';
    this.code = code;
  }
}

export interface ParticipantIdentity {
  fullId: string;
  publicCode: string;
}

export interface WalletProof {
  address: string;
  message: string;
  signature: string;
  network: 'testnet' | 'mainnet' | string;
}

export interface FeedbackInput {
  easeRating: number;
  taskCompleted: boolean;
  wouldUseAgain: boolean;
  mostValuableAspect: string;
  biggestFriction: string;
  quoteConsent: boolean;
}

export interface ValidatedFeedback extends FeedbackInput {
  submittedAt: number;
}

export interface EnrollmentStatus {
  participantCode: string;
  consentVersion: string;
  enrolledAt: string;
  retentionDeadline: string;
}

export interface Challenge {
  id: string;
  message: string;
  expiresAt: string;
}

export interface WalletVerificationResult {
  verified: true;
  addressRedacted: string;
  verifiedAt: string;
}

export interface EvaluationStatus {
  participantCode: string;
  consentVersion: string;
  enrolledAt: string;
  retentionDeadline: string;
  wallet: {
    verified: boolean;
    addressRedacted: string | null;
  };
  deposit: {
    confirmed: boolean;
    transactionHash: string | null;
    explorerUrl: string | null;
    newRoot: string | null;
  };
  feedbackSubmitted: boolean;
  complete: boolean;
}

export type CheckoutProcessingStatus = 'pending' | 'processing' | 'confirmed' | 'failed';

export interface CheckoutReceipt {
  checkoutSessionId: string;
  amountCents: number;
  processingStatus: CheckoutProcessingStatus;
  transactionHash: string | null;
  newRoot: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface CheckoutClaim {
  receipt: CheckoutReceipt;
  claimed: boolean;
}

export interface RestrictedEvaluationRecord {
  participantId: string;
  participantCode: string;
  consentVersion: string;
  enrolledAtMs: number;
  retentionDeadlineMs: number;
  walletAddress: string | null;
  walletSignature: string | null;
  walletVerifiedAtMs: number | null;
  depositTransactionHash: string | null;
  depositExplorerUrl: string | null;
  depositNewRoot: string | null;
  depositConfirmedAtMs: number | null;
  feedback: ValidatedFeedback | null;
  anonymizedAtMs: number | null;
}

export interface EvaluationStore {
  enroll(participantId: string, consentVersion: string): Promise<EnrollmentStatus>;
  createChallenge(participantId: string): Promise<Challenge>;
  verifyWallet(
    participantId: string,
    proof: Omit<WalletProof, 'message'> & { challengeId: string; message?: string },
  ): Promise<WalletVerificationResult>;
  linkDeposit(
    participantId: string,
    transactionHash: string,
    options?: { newRoot?: string; confirmedAt?: number },
  ): Promise<EvaluationStatus>;
  submitFeedback(participantId: string, input: Partial<FeedbackInput>): Promise<EvaluationStatus>;
  recordCheckout(
    participantId: string,
    input: { checkoutSessionId: string; amountCents: number; eventId?: string },
  ): Promise<CheckoutReceipt>;
  claimCheckout(
    participantId: string,
    checkoutSessionId: string,
    options?: { leaseMs?: number },
  ): Promise<CheckoutClaim>;
  markCheckout(
    participantId: string,
    checkoutSessionId: string,
    input: { status: CheckoutProcessingStatus; transactionHash?: string; newRoot?: string },
  ): Promise<CheckoutReceipt>;
  getCheckout(participantId: string, checkoutSessionId: string): Promise<CheckoutReceipt>;
  getStatus(participantId: string): Promise<EvaluationStatus>;
  listRestrictedRecords(): Promise<RestrictedEvaluationRecord[]>;
  purgeExpired(at?: number): Promise<number>;
}

interface ChallengeRecord extends Challenge {
  participantId: string;
  expiresAtMs: number;
  createdAtMs: number;
  usedAtMs: number | null;
}

interface ParticipantRecord extends RestrictedEvaluationRecord {
  challengeIds: string[];
  walletFingerprint: string | null;
}

interface CheckoutReceiptRecord extends CheckoutReceipt {
  participantId: string;
  eventId: string | null;
  receivedAtMs: number;
  processedAtMs: number | null;
  processingStartedAtMs: number | null;
  attemptCount: number;
}

export interface EvidenceParticipant {
  participantCode: string;
  walletAddress: string;
  transactionHash: string;
  completedAt: string;
}

export interface EvidenceFeedbackSummary {
  responses: number;
  easeAverage: number;
  taskCompletionRate: number;
  wouldUseAgainRate: number;
  quoteConsentCount: number;
}

export interface Level4Evidence {
  generatedAt: string;
  participants: EvidenceParticipant[];
  feedbackSummary: EvidenceFeedbackSummary;
}

/** Derive the opaque participant identifier from an authenticated provider subject. */
export function deriveParticipantIdentity(subject: string, secret: string): ParticipantIdentity {
  if (typeof subject !== 'string' || !subject || subject.length > 512) {
    throw new EvaluationError('invalid_subject', 'Authenticated subject is required');
  }
  if (typeof secret !== 'string' || !secret) {
    throw new EvaluationError('invalid_secret', 'EVALUATION_HMAC_SECRET is required');
  }

  const fullId = createHmac('sha256', secret).update(subject, 'utf8').digest('hex');
  return { fullId, publicCode: `L4-${fullId.slice(0, 12)}` };
}

/** Build the SHA-256 digest required by the SEP-53 signed-message flow. */
export function buildSep53PayloadDigest(message: string | Uint8Array): Buffer {
  const payload = Buffer.concat([
    Buffer.from(SEP53_PREFIX, 'utf8'),
    typeof message === 'string' ? Buffer.from(message, 'utf8') : Buffer.from(message),
  ]);
  return createHash('sha256').update(payload).digest();
}

function isCanonicalBase64(value: string): boolean {
  if (typeof value !== 'string' || !value || !BASE64_SIGNATURE_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 64 && decoded.toString('base64') === value;
}

/** Verify a Freighter proof on Stellar Testnet using canonical SEP-53 encoding. */
export function verifyWalletProof(proof: WalletProof): boolean {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return false;
  if (proof.network !== 'testnet') return false;
  if (typeof proof.address !== 'string' || !WALLET_ADDRESS_PATTERN.test(proof.address)) return false;
  if (typeof proof.message !== 'string' || proof.message.length === 0 || proof.message.length > 2_048) {
    return false;
  }
  if (typeof proof.signature !== 'string' || !isCanonicalBase64(proof.signature)) return false;

  try {
    const keypair = Keypair.fromPublicKey(proof.address);
    return keypair.verify(
      buildSep53PayloadDigest(proof.message),
      Buffer.from(proof.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function isNonEmptyBoundedText(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_FEEDBACK_TEXT_LENGTH;
}

export type FeedbackValidation =
  | { ok: true; value: FeedbackInput }
  | { ok: false; code: EvaluationErrorCode };

export function validateFeedback(input: Partial<FeedbackInput>): FeedbackValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'invalid_ease_rating' };
  }
  if (typeof input.easeRating !== 'number'
    || !Number.isInteger(input.easeRating)
    || input.easeRating < 1
    || input.easeRating > 5) {
    return { ok: false, code: 'invalid_ease_rating' };
  }
  if (typeof input.taskCompleted !== 'boolean') {
    return { ok: false, code: 'invalid_task_completed' };
  }
  if (typeof input.wouldUseAgain !== 'boolean') {
    return { ok: false, code: 'invalid_would_use_again' };
  }
  if (!isNonEmptyBoundedText(input.mostValuableAspect)
    || !isNonEmptyBoundedText(input.biggestFriction)) {
    return { ok: false, code: 'invalid_feedback_text' };
  }
  if (typeof input.quoteConsent !== 'boolean') {
    return { ok: false, code: 'invalid_quote_consent' };
  }

  return {
    ok: true,
    value: {
      easeRating: input.easeRating,
      taskCompleted: input.taskCompleted,
      wouldUseAgain: input.wouldUseAgain,
      mostValuableAspect: input.mostValuableAspect.trim(),
      biggestFriction: input.biggestFriction.trim(),
      quoteConsent: input.quoteConsent,
    },
  };
}

export function redactWalletAddress(address: string): string {
  if (typeof address !== 'string' || !WALLET_ADDRESS_PATTERN.test(address)) return '[redacted]';
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Retained pseudonymous ownership marker; raw wallet material is still purgeable. */
export function fingerprintWalletAddress(address: string): string {
  return createHash('sha256').update(address, 'utf8').digest('hex');
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function assertParticipantId(participantId: string): void {
  if (typeof participantId !== 'string' || !/^[a-f0-9]{64}$/.test(participantId)) {
    throw new EvaluationError('invalid_subject', 'Participant identifier must be a SHA-256 HMAC');
  }
}

function assertConsentVersion(consentVersion: string): void {
  if (consentVersion !== EVALUATION_CONSENT_VERSION) {
    throw new EvaluationError('invalid_consent_version', 'The active consent version is required');
  }
}

function cloneFeedback(feedback: ValidatedFeedback | null): ValidatedFeedback | null {
  return feedback ? { ...feedback } : null;
}

/** In-memory adapter used by unit tests and local development. */
export class MemoryEvaluationStore implements EvaluationStore {
  private readonly participants = new Map<string, ParticipantRecord>();
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly walletOwners = new Map<string, string>();
  private readonly transactionOwners = new Map<string, string>();
  private readonly checkoutReceipts = new Map<string, CheckoutReceiptRecord>();
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(options: { now?: () => number; id?: () => string } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.id = options.id ?? (() => randomBytes(18).toString('base64url'));
  }

  async enroll(participantId: string, consentVersion: string): Promise<EnrollmentStatus> {
    assertParticipantId(participantId);
    assertConsentVersion(consentVersion);

    const existing = this.participants.get(participantId);
    if (existing) {
      if (existing.consentVersion === consentVersion) return this.toEnrollmentStatus(existing);
      throw new EvaluationError('already_enrolled', 'Participant is already enrolled');
    }

    const enrolledAtMs = this.now();
    const record: ParticipantRecord = {
      participantId,
      participantCode: `L4-${participantId.slice(0, 12)}`,
      consentVersion,
      enrolledAtMs,
      retentionDeadlineMs: enrolledAtMs + RETENTION_MS,
      walletAddress: null,
      walletSignature: null,
      walletVerifiedAtMs: null,
      depositTransactionHash: null,
      depositExplorerUrl: null,
      depositNewRoot: null,
      depositConfirmedAtMs: null,
      feedback: null,
      anonymizedAtMs: null,
      challengeIds: [],
      walletFingerprint: null,
    };
    this.participants.set(participantId, record);
    return this.toEnrollmentStatus(record);
  }

  async createChallenge(participantId: string): Promise<Challenge> {
    const participant = this.requireParticipant(participantId);
    const now = this.now();
    const recentChallenges = participant.challengeIds
      .map((challengeId) => this.challenges.get(challengeId))
      .filter((challenge): challenge is ChallengeRecord => Boolean(challenge))
      .filter((challenge) => challenge.createdAtMs >= now - CHALLENGE_RATE_WINDOW_MS);
    if (recentChallenges.length >= MAX_CHALLENGES_PER_WINDOW) {
      throw new EvaluationError('rate_limited', 'Too many wallet challenges');
    }

    const id = this.id();
    const expiresAtMs = now + CHALLENGE_TTL_MS;
    const challenge: ChallengeRecord = {
      id,
      participantId,
      expiresAt: toIso(expiresAtMs),
      expiresAtMs,
      createdAtMs: now,
      usedAtMs: null,
      message: [
        'Stellar Launch wallet verification',
        `Participant: ${participant.participantCode}`,
        `Challenge: ${id}`,
        'Network: stellar:testnet',
        `Expires: ${toIso(expiresAtMs)}`,
      ].join('\n'),
    };
    this.challenges.set(id, challenge);
    participant.challengeIds.push(id);
    return { id: challenge.id, message: challenge.message, expiresAt: challenge.expiresAt };
  }

  async verifyWallet(
    participantId: string,
    proof: Omit<WalletProof, 'message'> & { challengeId: string; message?: string },
  ): Promise<WalletVerificationResult> {
    if (!proof || typeof proof !== 'object' || typeof proof.challengeId !== 'string'
      || proof.challengeId.length === 0 || proof.challengeId.length > 256) {
      throw new EvaluationError('wallet_proof_invalid', 'Wallet proof could not be verified');
    }
    const participant = this.requireParticipant(participantId);
    const challenge = this.challenges.get(proof.challengeId);
    if (!challenge || challenge.participantId !== participantId) {
      throw new EvaluationError('challenge_not_found', 'Wallet challenge was not found');
    }
    if (challenge.usedAtMs !== null) {
      throw new EvaluationError('challenge_replayed', 'Wallet challenge has already been used');
    }
    if (this.now() >= challenge.expiresAtMs) {
      throw new EvaluationError('challenge_expired', 'Wallet challenge has expired');
    }
    if ((proof.message !== undefined && proof.message !== challenge.message)
      || !verifyWalletProof({ ...proof, message: challenge.message })) {
      throw new EvaluationError('wallet_proof_invalid', 'Wallet proof could not be verified');
    }
    const walletFingerprint = fingerprintWalletAddress(proof.address);
    const currentOwner = this.walletOwners.get(walletFingerprint);
    if (currentOwner && currentOwner !== participantId) {
      throw new EvaluationError('wallet_already_used', 'Wallet is already enrolled');
    }
    if (participant.walletFingerprint && participant.walletFingerprint !== walletFingerprint) {
      throw new EvaluationError('wallet_already_used', 'Participant already has a different wallet');
    }

    challenge.usedAtMs = this.now();
    if (participant.walletFingerprint === walletFingerprint) {
      if (participant.walletVerifiedAtMs === null) {
        throw new EvaluationError('wallet_proof_invalid', 'Wallet verification state is invalid');
      }
      return {
        verified: true,
        addressRedacted: redactWalletAddress(proof.address),
        verifiedAt: toIso(participant.walletVerifiedAtMs),
      };
    }

    const verifiedAtMs = challenge.usedAtMs;
    participant.walletAddress = proof.address;
    participant.walletSignature = proof.signature;
    participant.walletVerifiedAtMs = verifiedAtMs;
    participant.walletFingerprint = walletFingerprint;
    this.walletOwners.set(walletFingerprint, participantId);

    return { verified: true, addressRedacted: redactWalletAddress(proof.address), verifiedAt: toIso(verifiedAtMs) };
  }

  async linkDeposit(
    participantId: string,
    transactionHash: string,
    options: { newRoot?: string; confirmedAt?: number } = {},
  ): Promise<EvaluationStatus> {
    const participant = this.requireParticipant(participantId);
    if (participant.walletVerifiedAtMs === null) {
      throw new EvaluationError('wallet_not_verified', 'Wallet verification is required first');
    }
    if (typeof transactionHash !== 'string' || !TRANSACTION_HASH_PATTERN.test(transactionHash)) {
      throw new EvaluationError('invalid_transaction_hash', 'A Stellar transaction hash is required');
    }

    const normalizedHash = transactionHash.toLowerCase();
    const currentOwner = this.transactionOwners.get(normalizedHash);
    if (currentOwner && currentOwner !== participantId) {
      throw new EvaluationError('deposit_already_used', 'Deposit transaction is already linked');
    }
    if (participant.depositTransactionHash && participant.depositTransactionHash !== normalizedHash) {
      throw new EvaluationError('deposit_already_used', 'Participant already has a deposit linked');
    }

    const confirmedAt = options.confirmedAt ?? this.now();
    participant.depositTransactionHash = normalizedHash;
    participant.depositExplorerUrl = `https://stellar.expert/explorer/testnet/tx/${normalizedHash}`;
    participant.depositNewRoot = options.newRoot ?? null;
    participant.depositConfirmedAtMs = confirmedAt;
    this.transactionOwners.set(normalizedHash, participantId);
    return this.getStatus(participantId);
  }

  async submitFeedback(participantId: string, input: Partial<FeedbackInput>): Promise<EvaluationStatus> {
    const participant = this.requireParticipant(participantId);
    if (participant.walletVerifiedAtMs === null || !participant.depositTransactionHash) {
      throw new EvaluationError('feedback_not_ready', 'Wallet verification and deposit are required first');
    }
    const validated = validateFeedback(input);
    if (!validated.ok) throw new EvaluationError(validated.code, 'Feedback fields are invalid');

    participant.feedback = { ...validated.value, submittedAt: this.now() };
    return this.getStatus(participantId);
  }

  async recordCheckout(
    participantId: string,
    input: { checkoutSessionId: string; amountCents: number; eventId?: string },
  ): Promise<CheckoutReceipt> {
    this.requireParticipant(participantId);
    if (!input || typeof input.checkoutSessionId !== 'string'
      || input.checkoutSessionId.length === 0 || input.checkoutSessionId.length > 255
      || !Number.isInteger(input.amountCents)
      || input.amountCents !== EVALUATION_CHECKOUT_AMOUNT_CENTS) {
      throw new EvaluationError('checkout_invalid', 'Checkout receipt fields are invalid');
    }
    const existing = this.checkoutReceipts.get(input.checkoutSessionId);
    if (existing && existing.participantId !== participantId) {
      throw new EvaluationError('checkout_already_used', 'Checkout session is already linked');
    }
    if (existing) {
      if (existing.amountCents !== input.amountCents) {
        throw new EvaluationError('checkout_invalid', 'Checkout receipt amount cannot change');
      }
      return this.toCheckoutReceipt(existing);
    }
    const receivedAtMs = this.now();
    const record: CheckoutReceiptRecord = {
      checkoutSessionId: input.checkoutSessionId,
      participantId,
      amountCents: input.amountCents,
      processingStatus: 'pending',
      transactionHash: null,
      newRoot: null,
      receivedAt: toIso(receivedAtMs),
      processedAt: null,
      receivedAtMs,
      processedAtMs: null,
      eventId: input.eventId ?? null,
      processingStartedAtMs: null,
      attemptCount: 0,
    };
    this.checkoutReceipts.set(record.checkoutSessionId, record);
    return this.toCheckoutReceipt(record);
  }

  async claimCheckout(
    participantId: string,
    checkoutSessionId: string,
    options: { leaseMs?: number } = {},
  ): Promise<CheckoutClaim> {
    this.requireParticipant(participantId);
    const record = this.checkoutReceipts.get(checkoutSessionId);
    if (!record || record.participantId !== participantId) {
      throw new EvaluationError('checkout_not_found', 'Checkout receipt was not found');
    }
    if (record.processingStatus === 'confirmed') {
      return { receipt: this.toCheckoutReceipt(record), claimed: false };
    }

    const leaseMs = options.leaseMs ?? CHECKOUT_PROCESSING_LEASE_MS;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new EvaluationError('checkout_invalid', 'Checkout processing lease is invalid');
    }
    const now = this.now();
    const processingIsActive = record.processingStatus === 'processing'
      && record.processingStartedAtMs !== null
      && record.processingStartedAtMs + leaseMs > now;
    if (processingIsActive) {
      return { receipt: this.toCheckoutReceipt(record), claimed: false };
    }

    record.processingStatus = 'processing';
    record.processingStartedAtMs = now;
    record.attemptCount += 1;
    record.processedAtMs = null;
    record.processedAt = null;
    return { receipt: this.toCheckoutReceipt(record), claimed: true };
  }

  async markCheckout(
    participantId: string,
    checkoutSessionId: string,
    input: { status: CheckoutProcessingStatus; transactionHash?: string; newRoot?: string },
  ): Promise<CheckoutReceipt> {
    const record = this.checkoutReceipts.get(checkoutSessionId);
    if (!record || record.participantId !== participantId) {
      throw new EvaluationError('checkout_not_found', 'Checkout receipt was not found');
    }
    if (!input || !isCheckoutProcessingStatus(input.status)) {
      throw new EvaluationError('checkout_invalid', 'Checkout status is invalid');
    }
    if (record.processingStatus === 'confirmed') return this.toCheckoutReceipt(record);
    if (input.transactionHash
      && (typeof input.transactionHash !== 'string' || !TRANSACTION_HASH_PATTERN.test(input.transactionHash))) {
      throw new EvaluationError('invalid_transaction_hash', 'A Stellar transaction hash is required');
    }
    const processedAtMs = input.status === 'pending' || input.status === 'processing' ? null : this.now();
    record.processingStatus = input.status;
    record.transactionHash = input.transactionHash?.toLowerCase() ?? record.transactionHash;
    record.newRoot = input.newRoot ?? record.newRoot;
    record.processedAtMs = processedAtMs;
    record.processedAt = processedAtMs === null ? null : toIso(processedAtMs);
    record.processingStartedAtMs = input.status === 'processing' ? this.now() : null;
    return this.toCheckoutReceipt(record);
  }

  async getCheckout(participantId: string, checkoutSessionId: string): Promise<CheckoutReceipt> {
    const record = this.checkoutReceipts.get(checkoutSessionId);
    if (!record || record.participantId !== participantId) {
      throw new EvaluationError('checkout_not_found', 'Checkout receipt was not found');
    }
    return this.toCheckoutReceipt(record);
  }

  async getStatus(participantId: string): Promise<EvaluationStatus> {
    const participant = this.requireParticipant(participantId);
    return {
      participantCode: participant.participantCode,
      consentVersion: participant.consentVersion,
      enrolledAt: toIso(participant.enrolledAtMs),
      retentionDeadline: toIso(participant.retentionDeadlineMs),
      wallet: {
        verified: participant.walletVerifiedAtMs !== null,
        addressRedacted: participant.walletAddress ? redactWalletAddress(participant.walletAddress) : null,
      },
      deposit: {
        confirmed: participant.depositConfirmedAtMs !== null,
        transactionHash: participant.depositTransactionHash,
        explorerUrl: participant.depositExplorerUrl,
        newRoot: participant.depositNewRoot,
      },
      feedbackSubmitted: participant.feedback !== null,
      complete: participant.walletVerifiedAtMs !== null
        && participant.depositConfirmedAtMs !== null
        && participant.feedback !== null,
    };
  }

  /** Restricted rows are for the evidence worker only and never for a browser. */
  async listRestrictedRecords(): Promise<RestrictedEvaluationRecord[]> {
    return Array.from(this.participants.values()).map((record) => ({
      participantId: record.participantId,
      participantCode: record.participantCode,
      consentVersion: record.consentVersion,
      enrolledAtMs: record.enrolledAtMs,
      retentionDeadlineMs: record.retentionDeadlineMs,
      walletAddress: record.walletAddress,
      walletSignature: record.walletSignature,
      walletVerifiedAtMs: record.walletVerifiedAtMs,
      depositTransactionHash: record.depositTransactionHash,
      depositExplorerUrl: record.depositExplorerUrl,
      depositNewRoot: record.depositNewRoot,
      depositConfirmedAtMs: record.depositConfirmedAtMs,
      feedback: cloneFeedback(record.feedback),
      anonymizedAtMs: record.anonymizedAtMs,
    }));
  }

  /** Remove raw wallet proof material after the retention deadline. */
  async purgeExpired(at = this.now()): Promise<number> {
    let purged = 0;
    for (const participant of this.participants.values()) {
      if (participant.anonymizedAtMs !== null || participant.retentionDeadlineMs > at) continue;
      participant.walletAddress = null;
      participant.walletSignature = null;
      participant.anonymizedAtMs = at;
      purged += 1;
    }
    return purged;
  }

  private requireParticipant(participantId: string): ParticipantRecord {
    assertParticipantId(participantId);
    const participant = this.participants.get(participantId);
    if (!participant) throw new EvaluationError('not_enrolled', 'Participant is not enrolled');
    return participant;
  }

  private toEnrollmentStatus(participant: ParticipantRecord): EnrollmentStatus {
    return {
      participantCode: participant.participantCode,
      consentVersion: participant.consentVersion,
      enrolledAt: toIso(participant.enrolledAtMs),
      retentionDeadline: toIso(participant.retentionDeadlineMs),
    };
  }

  private toCheckoutReceipt(record: CheckoutReceiptRecord): CheckoutReceipt {
    return {
      checkoutSessionId: record.checkoutSessionId,
      amountCents: record.amountCents,
      processingStatus: record.processingStatus,
      transactionHash: record.transactionHash,
      newRoot: record.newRoot,
      receivedAt: record.receivedAt,
      processedAt: record.processedAt,
    };
  }
}

function isComplete(record: RestrictedEvaluationRecord): boolean {
  return record.walletAddress !== null
    && record.walletVerifiedAtMs !== null
    && record.depositTransactionHash !== null
    && record.depositConfirmedAtMs !== null
    && record.feedback !== null;
}

/** Produce the public, redacted shape used for evidence handoff. */
export async function exportEvidence(
  store: Pick<EvaluationStore, 'listRestrictedRecords'>,
): Promise<Level4Evidence> {
  const records = (await store.listRestrictedRecords()).filter(isComplete);
  const uniqueWallets = new Set(records.map((record) => record.walletAddress));
  const uniqueTransactions = new Set(records.map((record) => record.depositTransactionHash));
  if (records.length < 10 || uniqueWallets.size < 10 || uniqueTransactions.size < 10) {
    throw new EvaluationError('minimum_participants', 'At least ten unique completed participants are required');
  }

  const participants = records.map((record) => ({
    participantCode: record.participantCode,
    walletAddress: redactWalletAddress(record.walletAddress as string),
    transactionHash: record.depositTransactionHash as string,
    completedAt: toIso(record.feedback?.submittedAt ?? record.depositConfirmedAtMs as number),
  }));
  const feedback = records.map((record) => record.feedback as ValidatedFeedback);
  return {
    generatedAt: new Date().toISOString(),
    participants,
    feedbackSummary: {
      responses: feedback.length,
      easeAverage: Number((feedback.reduce((sum, item) => sum + item.easeRating, 0) / feedback.length).toFixed(2)),
      taskCompletionRate: feedback.filter((item) => item.taskCompleted).length / feedback.length,
      wouldUseAgainRate: feedback.filter((item) => item.wouldUseAgain).length / feedback.length,
      quoteConsentCount: feedback.filter((item) => item.quoteConsent).length,
    },
  };
}
