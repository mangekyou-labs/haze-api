-- Revised A/B/C roles: external Codex A, founder x402 B, external x402 C.
-- Keep the earlier C assignment accepted for historical rows from the prior
-- cohort definition. Current evidence validation only permits the revised C
-- assignment, and all newly opened attempts use the application assignment.

ALTER TABLE control_plane.activation_attempts
  DROP CONSTRAINT activation_attempts_slot_assignment_check;

ALTER TABLE control_plane.activation_attempts
  ADD CONSTRAINT activation_attempts_slot_assignment_check CHECK (
    (slot = 'A' AND participant_type = 'coding_agent' AND integration_mode = 'openai_compatible_sidecar')
    OR (slot = 'B' AND participant_type = 'x402_native_agent' AND integration_mode = 'x402_zk_prepaid_adapter')
    OR (slot = 'C' AND participant_type = 'x402_native_agent' AND integration_mode = 'x402_zk_prepaid_adapter')
    OR (slot = 'C' AND participant_type = 'coding_agent' AND integration_mode = 'openai_compatible_sidecar')
  );
