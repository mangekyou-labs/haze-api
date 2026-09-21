import {
  CHECKOUT_PROCESSING_LEASE_MS,
  CHALLENGE_TTL_MS,
  EVALUATION_CHECKOUT_AMOUNT_CENTS,
  EVALUATION_CONSENT_VERSION,
  RETENTION_MS,
  EvaluationError,
  type Challenge,
  type CheckoutClaim,
  type CheckoutProcessingStatus,
  type CheckoutReceipt,
  type EnrollmentStatus,
  type EvaluationStatus,
  type FeedbackInput,
  type EvaluationStore,
  type RestrictedEvaluationRecord,
  type ValidatedFeedback,
  type WalletProof,
  type WalletVerificationResult,
  fingerprintWalletAddress,
  redactWalletAddress,
  validateFeedback,
  verifyWalletProof,
} from './evaluation.js';

export interface SqlResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface SqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
  release(): void;
}

/** The narrow pool contract lets integration tests inject controlled query behavior. */
export interface SqlPool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<Row>>;
  connect(): Promise<SqlClient>;
}

interface ParticipantRow extends Record<string, unknown> {
  participant_id: string;
  public_code: string;
  consent_version: string;
  enrolled_at: Date | string;
  retention_deadline: Date | string;
  wallet_address: string | null;
  wallet_fingerprint: string | null;
  wallet_signature: string | null;
  wallet_verified_at: Date | string | null;
  deposit_tx_hash: string | null;
  deposit_explorer_url: string | null;
  deposit_new_root: string | null;
  deposit_confirmed_at: Date | string | null;
  ease_rating: number | null;
  task_completed: boolean | null;
  would_use_again: boolean | null;
  most_valuable_aspect: string | null;
  biggest_friction: string | null;
  quote_consent: boolean | null;
  feedback_submitted_at: Date | string | null;
  anonymized_at: Date | string | null;
}

interface ChallengeRow extends Record<string, unknown> {
  challenge_id: string;
  participant_id: string;
  message: string;
  created_at: Date | string;
  expires_at: Date | string;
  used_at: Date | string | null;
}

interface CheckoutRow extends Record<string, unknown> {
  checkout_session_id: string;
  participant_id: string;
  amount_cents: number;
  processing_status: CheckoutProcessingStatus;
  event_id: string | null;
  deposit_tx_hash: string | null;
  new_root: string | null;
  received_at: Date | string;
  processed_at: Date | string | null;
}

function millis(value: Date | string | null): number | null {
  if (value === null) return null;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function requiredMillis(value: Date | string): number {
  const result = millis(value);
  if (result === null || Number.isNaN(result)) throw new Error('Invalid timestamp from evaluation database');
  return result;
}

function feedbackFromRow(row: ParticipantRow): ValidatedFeedback | null {
  if (row.feedback_submitted_at === null) return null;
  if (row.ease_rating === null
    || row.task_completed === null
    || row.would_use_again === null
    || row.most_valuable_aspect === null
    || row.biggest_friction === null
    || row.quote_consent === null) {
    throw new Error('Incomplete feedback row in evaluation database');
  }
  return {
    easeRating: row.ease_rating,
    taskCompleted: row.task_completed,
    wouldUseAgain: row.would_use_again,
    mostValuableAspect: row.most_valuable_aspect,
    biggestFriction: row.biggest_friction,
    quoteConsent: row.quote_consent,
    submittedAt: requiredMillis(row.feedback_submitted_at),
  };
}

function rowToRestricted(row: ParticipantRow): RestrictedEvaluationRecord {
  return {
    participantId: row.participant_id,
    participantCode: row.public_code,
    consentVersion: row.consent_version,
    enrolledAtMs: requiredMillis(row.enrolled_at),
    retentionDeadlineMs: requiredMillis(row.retention_deadline),
    walletAddress: row.wallet_address,
    walletSignature: row.wallet_signature,
    walletVerifiedAtMs: millis(row.wallet_verified_at),
    depositTransactionHash: row.deposit_tx_hash,
    depositExplorerUrl: row.deposit_explorer_url,
    depositNewRoot: row.deposit_new_root,
    depositConfirmedAtMs: millis(row.deposit_confirmed_at),
    feedback: feedbackFromRow(row),
    anonymizedAtMs: millis(row.anonymized_at),
  };
}

function rowToEnrollment(row: ParticipantRow): EnrollmentStatus {
  return {
    participantCode: row.public_code,
    consentVersion: row.consent_version,
    enrolledAt: new Date(requiredMillis(row.enrolled_at)).toISOString(),
    retentionDeadline: new Date(requiredMillis(row.retention_deadline)).toISOString(),
  };
}

function rowToStatus(row: ParticipantRow): EvaluationStatus {
  const restricted = rowToRestricted(row);
  return {
    participantCode: restricted.participantCode,
    consentVersion: restricted.consentVersion,
    enrolledAt: new Date(restricted.enrolledAtMs).toISOString(),
    retentionDeadline: new Date(restricted.retentionDeadlineMs).toISOString(),
    wallet: {
      verified: restricted.walletVerifiedAtMs !== null,
      addressRedacted: restricted.walletAddress ? redactWalletAddress(restricted.walletAddress) : null,
    },
    deposit: {
      confirmed: restricted.depositConfirmedAtMs !== null,
      transactionHash: restricted.depositTransactionHash,
      explorerUrl: restricted.depositExplorerUrl,
      newRoot: restricted.depositNewRoot,
    },
    feedbackSubmitted: restricted.feedback !== null,
    complete: restricted.walletVerifiedAtMs !== null
      && restricted.depositConfirmedAtMs !== null
      && restricted.feedback !== null,
  };
}

function rowToCheckout(row: CheckoutRow): CheckoutReceipt {
  return {
    checkoutSessionId: row.checkout_session_id,
    amountCents: row.amount_cents,
    processingStatus: row.processing_status,
    transactionHash: row.deposit_tx_hash,
    newRoot: row.new_root,
    receivedAt: new Date(requiredMillis(row.received_at)).toISOString(),
    processedAt: row.processed_at === null ? null : new Date(requiredMillis(row.processed_at)).toISOString(),
  };
}

function isParticipantId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === '23505';
}

function assertParticipantId(participantId: string): void {
  if (!isParticipantId(participantId)) {
    throw new EvaluationError('invalid_subject', 'Participant identifier must be a SHA-256 HMAC');
  }
}

function assertConsentVersion(consentVersion: string): void {
  if (consentVersion !== EVALUATION_CONSENT_VERSION) {
    throw new EvaluationError('invalid_consent_version', 'The active consent version is required');
  }
}

function assertCheckoutInput(input: { checkoutSessionId: string; amountCents: number }): void {
  if (!input || typeof input.checkoutSessionId !== 'string'
    || input.checkoutSessionId.length === 0 || input.checkoutSessionId.length > 255
    || !Number.isInteger(input.amountCents)
    || input.amountCents !== EVALUATION_CHECKOUT_AMOUNT_CENTS) {
    throw new EvaluationError('checkout_invalid', 'Checkout receipt fields are invalid');
  }
}

/** PostgreSQL adapter for the isolated evaluation schema. */
export class PostgresEvaluationStore implements EvaluationStore {
  constructor(
    private readonly pool: SqlPool,
    private readonly options: { now?: () => number; id?: () => string } = {},
  ) {}

  private currentTime(): number {
    return this.options.now?.() ?? Date.now();
  }

  private challengeId(): string {
    if (this.options.id) return this.options.id();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }

  private async participant(participantId: string): Promise<ParticipantRow> {
    assertParticipantId(participantId);
    const result = await this.pool.query<ParticipantRow>(
      'SELECT * FROM evaluation.participants WHERE participant_id = $1',
      [participantId],
    );
    const row = result.rows[0];
    if (!row) throw new EvaluationError('not_enrolled', 'Participant is not enrolled');
    return row;
  }

  async enroll(participantId: string, consentVersion: string): Promise<EnrollmentStatus> {
    assertParticipantId(participantId);
    assertConsentVersion(consentVersion);
    const enrolledAt = new Date(this.currentTime());
    const retentionDeadline = new Date(enrolledAt.getTime() + RETENTION_MS);
    await this.pool.query(
      `INSERT INTO evaluation.participants
        (participant_id, public_code, consent_version, enrolled_at, retention_deadline)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (participant_id) DO NOTHING`,
      [participantId, `L4-${participantId.slice(0, 12)}`, consentVersion, enrolledAt, retentionDeadline],
    );
    const row = await this.participant(participantId);
    if (row.consent_version !== consentVersion) {
      throw new EvaluationError('already_enrolled', 'Participant is already enrolled');
    }
    return rowToEnrollment(row);
  }

  async createChallenge(participantId: string): Promise<Challenge> {
    const participant = await this.participant(participantId);
    const now = new Date(this.currentTime());
    const id = this.challengeId();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const message = [
      'Stellar Launch wallet verification',
      `Participant: ${participant.public_code}`,
      `Challenge: ${id}`,
      'Network: stellar:testnet',
      `Expires: ${expiresAt.toISOString()}`,
    ].join('\n');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT participant_id FROM evaluation.participants WHERE participant_id = $1 FOR UPDATE',
        [participantId],
      );
      const recent = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM evaluation.wallet_challenges
          WHERE participant_id = $1 AND created_at >= $2`,
        [participantId, new Date(now.getTime() - 15 * 60 * 1000)],
      );
      if (Number(recent.rows[0]?.count ?? 0) >= 5) {
        throw new EvaluationError('rate_limited', 'Too many wallet challenges');
      }
      await client.query(
        `INSERT INTO evaluation.wallet_challenges
          (challenge_id, participant_id, message, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, participantId, message, now, expiresAt],
      );
      await client.query('COMMIT');
      return { id, message, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyWallet(
    participantId: string,
    proof: Omit<WalletProof, 'message'> & { challengeId: string; message?: string },
  ): Promise<WalletVerificationResult> {
    if (!proof || typeof proof !== 'object' || typeof proof.challengeId !== 'string'
      || proof.challengeId.length === 0 || proof.challengeId.length > 256) {
      throw new EvaluationError('wallet_proof_invalid', 'Wallet proof could not be verified');
    }
    const participant = await this.participant(participantId);
    const challengeResult = await this.pool.query<ChallengeRow>(
      'SELECT * FROM evaluation.wallet_challenges WHERE challenge_id = $1 AND participant_id = $2',
      [proof.challengeId, participantId],
    );
    const challenge = challengeResult.rows[0];
    if (!challenge) throw new EvaluationError('challenge_not_found', 'Wallet challenge was not found');
    if (challenge.used_at !== null) throw new EvaluationError('challenge_replayed', 'Wallet challenge has already been used');
    if (this.currentTime() >= new Date(challenge.expires_at).getTime()) {
      throw new EvaluationError('challenge_expired', 'Wallet challenge has expired');
    }
    if ((proof.message !== undefined && proof.message !== challenge.message)
      || !verifyWalletProof({ ...proof, message: challenge.message })) {
      throw new EvaluationError('wallet_proof_invalid', 'Wallet proof could not be verified');
    }

    const walletFingerprint = fingerprintWalletAddress(proof.address);
    const owner = await this.pool.query<{ participant_id: string }>(
      'SELECT participant_id FROM evaluation.participants WHERE wallet_fingerprint = $1',
      [walletFingerprint],
    );
    if (owner.rows[0] && owner.rows[0].participant_id !== participantId) {
      throw new EvaluationError('wallet_already_used', 'Wallet is already enrolled');
    }
    if (participant.wallet_fingerprint && participant.wallet_fingerprint !== walletFingerprint) {
      throw new EvaluationError('wallet_already_used', 'Participant already has a different wallet');
    }

    const verifiedAt = new Date(this.currentTime());
    const challengeUpdate = await this.pool.query(
      `UPDATE evaluation.wallet_challenges
          SET used_at = $1
        WHERE challenge_id = $2 AND participant_id = $3 AND used_at IS NULL`,
      [verifiedAt, proof.challengeId, participantId],
    );
    if (challengeUpdate.rowCount !== 1) {
      throw new EvaluationError('challenge_replayed', 'Wallet challenge has already been used');
    }
    if (participant.wallet_fingerprint === walletFingerprint) {
      if (participant.wallet_verified_at === null) {
        throw new EvaluationError('wallet_proof_invalid', 'Wallet verification state is invalid');
      }
      return {
        verified: true,
        addressRedacted: redactWalletAddress(proof.address),
        verifiedAt: new Date(participant.wallet_verified_at).toISOString(),
      };
    }
    try {
      const participantUpdate = await this.pool.query(
        `UPDATE evaluation.participants
            SET wallet_address = $1, wallet_fingerprint = $2, wallet_signature = $3,
                wallet_verified_at = $4, updated_at = $4
          WHERE participant_id = $5
            AND ((wallet_fingerprint IS NULL AND (wallet_address IS NULL OR wallet_address = $1))
              OR wallet_fingerprint = $2)`,
        [proof.address, walletFingerprint, proof.signature, verifiedAt, participantId],
      );
      if (participantUpdate.rowCount !== 1) {
        throw new EvaluationError('wallet_already_used', 'Participant already has a different wallet');
      }
    } catch (error) {
      if (error instanceof EvaluationError) throw error;
      if (isUniqueViolation(error)) {
        throw new EvaluationError('wallet_already_used', 'Wallet is already enrolled');
      }
      throw error;
    }
    return {
      verified: true,
      addressRedacted: redactWalletAddress(proof.address),
      verifiedAt: verifiedAt.toISOString(),
    };
  }

  async linkDeposit(
    participantId: string,
    transactionHash: string,
    options: { newRoot?: string; confirmedAt?: number } = {},
  ): Promise<EvaluationStatus> {
    const participant = await this.participant(participantId);
    if (participant.wallet_verified_at === null) {
      throw new EvaluationError('wallet_not_verified', 'Wallet verification is required first');
    }
    if (typeof transactionHash !== 'string' || !/^[a-f0-9]{64}$/i.test(transactionHash)) {
      throw new EvaluationError('invalid_transaction_hash', 'A Stellar transaction hash is required');
    }
    const normalized = transactionHash.toLowerCase();
    const owner = await this.pool.query<{ participant_id: string }>(
      'SELECT participant_id FROM evaluation.participants WHERE deposit_tx_hash = $1',
      [normalized],
    );
    if (owner.rows[0] && owner.rows[0].participant_id !== participantId) {
      throw new EvaluationError('deposit_already_used', 'Deposit transaction is already linked');
    }
    if (participant.deposit_tx_hash && participant.deposit_tx_hash !== normalized) {
      throw new EvaluationError('deposit_already_used', 'Participant already has a deposit linked');
    }
    const confirmedAt = new Date(options.confirmedAt ?? this.currentTime());
    try {
      const participantUpdate = await this.pool.query(
        `UPDATE evaluation.participants
            SET deposit_tx_hash = $1, deposit_explorer_url = $2, deposit_new_root = $3,
                deposit_confirmed_at = $4, updated_at = $4
          WHERE participant_id = $5 AND (deposit_tx_hash IS NULL OR deposit_tx_hash = $1)`,
        [normalized, `https://stellar.expert/explorer/testnet/tx/${normalized}`, options.newRoot ?? null, confirmedAt, participantId],
      );
      if (participantUpdate.rowCount !== 1) {
        throw new EvaluationError('deposit_already_used', 'Participant already has a deposit linked');
      }
    } catch (error) {
      if (error instanceof EvaluationError) throw error;
      if (isUniqueViolation(error)) {
        throw new EvaluationError('deposit_already_used', 'Deposit transaction is already linked');
      }
      throw error;
    }
    return this.getStatus(participantId);
  }

  async submitFeedback(participantId: string, input: Partial<FeedbackInput>): Promise<EvaluationStatus> {
    const participant = await this.participant(participantId);
    if (participant.wallet_verified_at === null || !participant.deposit_tx_hash) {
      throw new EvaluationError('feedback_not_ready', 'Wallet verification and deposit are required first');
    }
    const validated = validateFeedback(input);
    if (!validated.ok) throw new EvaluationError(validated.code, 'Feedback fields are invalid');
    const submittedAt = new Date(this.currentTime());
    await this.pool.query(
      `UPDATE evaluation.participants
          SET ease_rating = $1, task_completed = $2, would_use_again = $3,
              most_valuable_aspect = $4, biggest_friction = $5, quote_consent = $6,
              feedback_submitted_at = $7, updated_at = $7
        WHERE participant_id = $8`,
      [validated.value.easeRating, validated.value.taskCompleted, validated.value.wouldUseAgain,
        validated.value.mostValuableAspect, validated.value.biggestFriction,
        validated.value.quoteConsent, submittedAt, participantId],
    );
    return this.getStatus(participantId);
  }

  async recordCheckout(
    participantId: string,
    input: { checkoutSessionId: string; amountCents: number; eventId?: string },
  ): Promise<CheckoutReceipt> {
    await this.participant(participantId);
    assertCheckoutInput(input);

    const inserted = await this.pool.query<CheckoutRow>(
      `INSERT INTO evaluation.checkout_receipts
        (checkout_session_id, participant_id, amount_cents, event_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (checkout_session_id) DO NOTHING
       RETURNING *`,
      [input.checkoutSessionId, participantId, input.amountCents, input.eventId ?? null],
    );
    if (inserted.rows[0]) return rowToCheckout(inserted.rows[0]);

    const existing = await this.pool.query<CheckoutRow>(
      'SELECT * FROM evaluation.checkout_receipts WHERE checkout_session_id = $1',
      [input.checkoutSessionId],
    );
    if (!existing.rows[0]) throw new EvaluationError('checkout_invalid', 'Checkout receipt could not be recorded');
    if (existing.rows[0].participant_id !== participantId) {
      throw new EvaluationError('checkout_already_used', 'Checkout session is already linked');
    }
    if (Number(existing.rows[0].amount_cents) !== input.amountCents) {
      throw new EvaluationError('checkout_invalid', 'Checkout receipt amount cannot change');
    }
    return rowToCheckout(existing.rows[0]);
  }

  async claimCheckout(
    participantId: string,
    checkoutSessionId: string,
    options: { leaseMs?: number } = {},
  ): Promise<CheckoutClaim> {
    await this.participant(participantId);
    const leaseMs = options.leaseMs ?? CHECKOUT_PROCESSING_LEASE_MS;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new EvaluationError('checkout_invalid', 'Checkout processing lease is invalid');
    }
    const now = new Date(this.currentTime());
    const leaseCutoff = new Date(now.getTime() - leaseMs);
    const claimed = await this.pool.query<CheckoutRow>(
      `UPDATE evaluation.checkout_receipts
          SET processing_status = 'processing', processing_started_at = $3,
              processed_at = NULL, last_error = NULL, attempt_count = attempt_count + 1,
              updated_at = $3
        WHERE checkout_session_id = $1 AND participant_id = $2
          AND processing_status <> 'confirmed'
          AND (processing_status <> 'processing'
            OR processing_started_at IS NULL
            OR processing_started_at <= $4)
       RETURNING *`,
      [checkoutSessionId, participantId, now, leaseCutoff],
    );
    if (claimed.rows[0]) return { receipt: rowToCheckout(claimed.rows[0]), claimed: true };

    const current = await this.pool.query<CheckoutRow>(
      `SELECT * FROM evaluation.checkout_receipts
        WHERE checkout_session_id = $1 AND participant_id = $2`,
      [checkoutSessionId, participantId],
    );
    if (!current.rows[0]) throw new EvaluationError('checkout_not_found', 'Checkout receipt was not found');
    return { receipt: rowToCheckout(current.rows[0]), claimed: false };
  }

  async markCheckout(
    participantId: string,
    checkoutSessionId: string,
    input: { status: CheckoutProcessingStatus; transactionHash?: string; newRoot?: string },
  ): Promise<CheckoutReceipt> {
    if (!input || !['pending', 'processing', 'confirmed', 'failed'].includes(input.status)) {
      throw new EvaluationError('checkout_invalid', 'Checkout status is invalid');
    }
    if (input.transactionHash
      && (typeof input.transactionHash !== 'string' || !/^[a-f0-9]{64}$/i.test(input.transactionHash))) {
      throw new EvaluationError('invalid_transaction_hash', 'A Stellar transaction hash is required');
    }
    const processedAt = input.status === 'pending' || input.status === 'processing'
      ? null
      : new Date(this.currentTime());
    const updated = await this.pool.query<CheckoutRow>(
      `UPDATE evaluation.checkout_receipts
          SET processing_status = $1, deposit_tx_hash = COALESCE($2, deposit_tx_hash),
              new_root = COALESCE($3, new_root),
              processing_started_at = CASE WHEN $1 = 'processing' THEN $5::timestamptz ELSE NULL END,
              processed_at = $4, updated_at = $5
        WHERE checkout_session_id = $6 AND participant_id = $7
          AND processing_status <> 'confirmed'
       RETURNING *`,
      [input.status, input.transactionHash?.toLowerCase() ?? null, input.newRoot ?? null, processedAt,
        new Date(this.currentTime()), checkoutSessionId, participantId],
    );
    if (updated.rows[0]) return rowToCheckout(updated.rows[0]);

    const current = await this.pool.query<CheckoutRow>(
      'SELECT * FROM evaluation.checkout_receipts WHERE checkout_session_id = $1 AND participant_id = $2',
      [checkoutSessionId, participantId],
    );
    if (!current.rows[0]) throw new EvaluationError('checkout_not_found', 'Checkout receipt was not found');
    return rowToCheckout(current.rows[0]);
  }

  async getCheckout(participantId: string, checkoutSessionId: string): Promise<CheckoutReceipt> {
    const result = await this.pool.query<CheckoutRow>(
      'SELECT * FROM evaluation.checkout_receipts WHERE checkout_session_id = $1 AND participant_id = $2',
      [checkoutSessionId, participantId],
    );
    if (!result.rows[0]) throw new EvaluationError('checkout_not_found', 'Checkout receipt was not found');
    return rowToCheckout(result.rows[0]);
  }

  async getStatus(participantId: string): Promise<EvaluationStatus> {
    return rowToStatus(await this.participant(participantId));
  }

  async listRestrictedRecords(): Promise<RestrictedEvaluationRecord[]> {
    const result = await this.pool.query<ParticipantRow>(
      'SELECT * FROM evaluation.participants ORDER BY enrolled_at ASC',
    );
    return result.rows.map(rowToRestricted);
  }

  async purgeExpired(at = this.currentTime()): Promise<number> {
    const result = await this.pool.query(
      `UPDATE evaluation.participants
          SET wallet_address = NULL, wallet_signature = NULL, anonymized_at = $1, updated_at = $1
        WHERE retention_deadline <= $1 AND anonymized_at IS NULL`,
      [new Date(at)],
    );
    return result.rowCount ?? 0;
  }
}
