CREATE EXTENSION IF NOT EXISTS citext;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "wallet_transaction_type" AS ENUM ('hold', 'settle', 'release', 'topup', 'refund', 'admin_adjustment');

-- CreateEnum
CREATE TYPE "wallet_reference_type" AS ENUM ('payment', 'generation', 'admin_adjustment');

-- CreateEnum
CREATE TYPE "wallet_actor_type" AS ENUM ('user', 'system', 'admin');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "generation_tool_type" AS ENUM ('ai_image', 'text_to_video', 'image_to_video');

-- CreateEnum
CREATE TYPE "generation_status" AS ENUM ('pending', 'submitted', 'processing', 'completed', 'failed', 'needs_reconciliation');

-- CreateEnum
CREATE TYPE "moderation_status" AS ENUM ('private', 'pending_review', 'published', 'rejected');

-- CreateEnum
CREATE TYPE "admin_action_type" AS ENUM ('credit_adjustment', 'content_hide', 'content_remove', 'user_suspend', 'user_reactivate');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'user',
    "status" "user_status" NOT NULL DEFAULT 'active',
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "password_reset_token_hash" TEXT,
    "password_reset_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "balance_credits" INTEGER NOT NULL DEFAULT 0,
    "held_credits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "wallet_transaction_type" NOT NULL,
    "amount_credits" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reference_type" "wallet_reference_type" NOT NULL,
    "reference_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "actor_type" "wallet_actor_type" NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_packages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "amount_tzs" INTEGER NOT NULL,
    "credits_granted" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "credit_package_id" UUID,
    "amount_tzs" INTEGER NOT NULL,
    "credits_granted" INTEGER NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "snippe_transaction_id" TEXT,
    "client_idempotency_key" TEXT,
    "snippe_reference" JSONB,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "signature_verified" BOOLEAN NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_configurations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tool_type" "generation_tool_type" NOT NULL,
    "model_used" TEXT NOT NULL,
    "duration_seconds" INTEGER,
    "cost_credits" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "generation_configuration_id" UUID NOT NULL,
    "tool_type" "generation_tool_type" NOT NULL,
    "model_used" TEXT NOT NULL,
    "status" "generation_status" NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "source_upload_id" UUID,
    "cost_credits" INTEGER NOT NULL,
    "provider_cost_amount" DECIMAL(14,6),
    "provider_cost_currency" TEXT,
    "output_asset_id" UUID,
    "provider_request_id" TEXT,
    "provider_status_url" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "generation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" BIGINT,
    "moderation_status" "moderation_status" NOT NULL DEFAULT 'private',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "action_type" "admin_action_type" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_user_id_created_at_idx" ON "wallet_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "wallet_transactions_reference_type_reference_id_idx" ON "wallet_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_snippe_transaction_id_key" ON "payments"("snippe_transaction_id");

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_user_id_client_idempotency_key_key" ON "payments"("user_id", "client_idempotency_key");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_created_at_idx" ON "payment_events"("payment_id", "created_at");

-- CreateIndex
CREATE INDEX "generation_configurations_tool_type_is_active_idx" ON "generation_configurations"("tool_type", "is_active");

-- CreateIndex
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "generations_output_asset_id_key" ON "generations"("output_asset_id");

-- CreateIndex
CREATE INDEX "generations_user_id_created_at_idx" ON "generations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "generations_status_idx" ON "generations"("status");

-- CreateIndex
CREATE INDEX "generations_provider_request_id_idx" ON "generations"("provider_request_id");

-- CreateIndex
CREATE INDEX "generations_generation_configuration_id_idx" ON "generations"("generation_configuration_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_generation_id_key" ON "assets"("generation_id");

-- CreateIndex
CREATE INDEX "assets_user_id_idx" ON "assets"("user_id");

-- CreateIndex
CREATE INDEX "assets_moderation_status_published_at_idx" ON "assets"("moderation_status", "published_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_admin_user_id_created_at_idx" ON "admin_audit_logs"("admin_user_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_target_type_target_id_idx" ON "admin_audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_credit_package_id_fkey" FOREIGN KEY ("credit_package_id") REFERENCES "credit_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_generation_configuration_id_fkey" FOREIGN KEY ("generation_configuration_id") REFERENCES "generation_configurations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_source_upload_id_fkey" FOREIGN KEY ("source_upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_output_asset_id_fkey" FOREIGN KEY ("output_asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "generations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
