-- Applied after the Prisma-generated tables. Idempotent guards are not required on a fresh migration.

CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE users
  ADD CONSTRAINT users_full_name_not_empty CHECK (char_length(full_name) > 0);

ALTER TABLE wallets
  ADD CONSTRAINT wallets_balance_non_negative CHECK (balance_credits >= 0),
  ADD CONSTRAINT wallets_held_non_negative CHECK (held_credits >= 0),
  ADD CONSTRAINT wallets_held_lte_balance CHECK (held_credits <= balance_credits);

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_amount_nonzero CHECK (amount_credits <> 0);

ALTER TABLE credit_packages
  ADD CONSTRAINT credit_packages_amount_positive CHECK (amount_tzs > 0),
  ADD CONSTRAINT credit_packages_credits_positive CHECK (credits_granted > 0);

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount_tzs > 0),
  ADD CONSTRAINT payments_credits_positive CHECK (credits_granted > 0);

ALTER TABLE generations
  ADD CONSTRAINT generations_cost_positive CHECK (cost_credits > 0),
  ADD CONSTRAINT generations_provider_cost_non_negative CHECK (provider_cost_amount IS NULL OR provider_cost_amount >= 0);

ALTER TABLE generation_configurations
  ADD CONSTRAINT generation_configurations_cost_positive CHECK (cost_credits > 0);

ALTER TABLE admin_audit_logs
  ADD CONSTRAINT admin_audit_logs_reason_not_empty CHECK (char_length(reason) > 0);

CREATE UNIQUE INDEX generation_configurations_one_active
  ON generation_configurations (tool_type, COALESCE(duration_seconds, -1))
  WHERE is_active;

CREATE UNIQUE INDEX wallet_transactions_one_hold_per_generation
  ON wallet_transactions (reference_id)
  WHERE type = 'hold' AND reference_type = 'generation';

CREATE UNIQUE INDEX wallet_transactions_one_terminal_per_generation
  ON wallet_transactions (reference_id)
  WHERE type IN ('settle', 'release') AND reference_type = 'generation';

CREATE UNIQUE INDEX wallet_transactions_one_topup_per_payment
  ON wallet_transactions (reference_id)
  WHERE type = 'topup' AND reference_type = 'payment';

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER wallets_set_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER credit_packages_set_updated_at BEFORE UPDATE ON credit_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER generation_configurations_set_updated_at BEFORE UPDATE ON generation_configurations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER generations_set_updated_at BEFORE UPDATE ON generations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
