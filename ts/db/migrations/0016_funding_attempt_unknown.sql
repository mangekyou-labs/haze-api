-- An uncertain Base broadcast is held until confirmed on-chain reconciliation.
ALTER TABLE pilot_provisioning.funding_capabilities
  DROP CONSTRAINT IF EXISTS funding_capabilities_state_check;
ALTER TABLE pilot_provisioning.funding_capabilities
  ADD CONSTRAINT funding_capabilities_state_check
  CHECK (state IN ('issued', 'funding', 'unknown', 'funded', 'failed'));
