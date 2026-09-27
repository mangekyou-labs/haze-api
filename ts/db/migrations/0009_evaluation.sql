-- 0009: isolated Level 4 evaluation records.
--
-- This schema is deliberately independent from gateway, billing, API-key,
-- commitment, proof, prompt, and request tables. participant_id is an HMAC
-- of the authenticated provider subject; the subject itself is never stored.
CREATE SCHEMA IF NOT EXISTS evaluation;

CREATE TABLE IF NOT EXISTS evaluation.participants (
    participant_id           text PRIMARY KEY,
    public_code              text NOT NULL UNIQUE,
    consent_version          text NOT NULL,
    enrolled_at              timestamptz NOT NULL DEFAULT now(),
    retention_deadline       timestamptz NOT NULL,
    wallet_address           text UNIQUE,
    wallet_signature         text,
    wallet_verified_at       timestamptz,
    deposit_tx_hash          text UNIQUE,
    deposit_explorer_url     text,
    deposit_new_root         text,
    deposit_confirmed_at     timestamptz,
    ease_rating              smallint,
    task_completed            boolean,
    would_use_again           boolean,
    most_valuable_aspect      text,
    biggest_friction          text,
    quote_consent             boolean,
    feedback_submitted_at     timestamptz,
    anonymized_at             timestamptz,
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT evaluation_participant_id_format
        CHECK (participant_id ~ '^[a-f0-9]{64}$'),
    CONSTRAINT evaluation_public_code_format
        CHECK (public_code ~ '^L4-[a-f0-9]{12}$'),
    CONSTRAINT evaluation_ease_rating_range
        CHECK (ease_rating IS NULL OR ease_rating BETWEEN 1 AND 5),
    CONSTRAINT evaluation_feedback_pair
        CHECK ((feedback_submitted_at IS NULL AND ease_rating IS NULL)
            OR (feedback_submitted_at IS NOT NULL AND ease_rating IS NOT NULL
                AND task_completed IS NOT NULL AND would_use_again IS NOT NULL
                AND most_valuable_aspect IS NOT NULL AND biggest_friction IS NOT NULL
                AND quote_consent IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS evaluation.wallet_challenges (
    challenge_id             text PRIMARY KEY,
    participant_id           text NOT NULL REFERENCES evaluation.participants(participant_id)
                              ON DELETE CASCADE,
    message                  text NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),
    expires_at                timestamptz NOT NULL,
    used_at                  timestamptz,
    CONSTRAINT evaluation_challenge_message_length CHECK (length(message) BETWEEN 1 AND 2048)
);

CREATE TABLE IF NOT EXISTS evaluation.checkout_receipts (
    checkout_session_id      text PRIMARY KEY,
    participant_id           text NOT NULL REFERENCES evaluation.participants(participant_id)
                              ON DELETE CASCADE,
    amount_cents              integer NOT NULL CHECK (amount_cents >= 0),
    processing_status         text NOT NULL DEFAULT 'pending'
                              CHECK (processing_status IN ('pending', 'processing', 'confirmed', 'failed')),
    event_id                  text,
    deposit_tx_hash           text UNIQUE,
    deposit_new_root          text,
    received_at               timestamptz NOT NULL DEFAULT now(),
    processed_at              timestamptz,
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evaluation_challenges_participant_created_idx
    ON evaluation.wallet_challenges (participant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_participants_retention_idx
    ON evaluation.participants (retention_deadline)
    WHERE anonymized_at IS NULL;
CREATE INDEX IF NOT EXISTS evaluation_participants_completion_idx
    ON evaluation.participants (feedback_submitted_at, deposit_confirmed_at, wallet_verified_at);

COMMENT ON SCHEMA evaluation IS
    'Consent-based Level 4 evaluation data; never join to private API or ZK request data.';
COMMENT ON COLUMN evaluation.participants.wallet_signature IS
    'Restricted raw SEP-53 signature; purge or anonymize at retention_deadline.';
COMMENT ON COLUMN evaluation.participants.wallet_address IS
    'Restricted complete Stellar testnet address; purge or anonymize at retention_deadline.';
