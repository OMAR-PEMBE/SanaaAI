export type ToolType = 'ai_image' | 'text_to_video' | 'image_to_video';

export type GenerationStatus =
  | 'pending'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'needs_reconciliation';

export type PublicGenerationStatus = Exclude<GenerationStatus, 'needs_reconciliation'>;

export type WalletTransactionType =
  | 'hold'
  | 'settle'
  | 'release'
  | 'topup'
  | 'refund'
  | 'admin_adjustment';

export type PaymentStatus = 'pending' | 'confirmed' | 'failed';

export type ModerationStatus = 'private' | 'pending_review' | 'published' | 'rejected';

export type UserRole = 'user' | 'admin';

export const FAILURE_MESSAGE = 'Something went wrong. Your credits were not charged.';
export const POLICY_MESSAGE = 'This request could not be completed. Your credits were not charged.';
export const UNAVAILABLE_MESSAGE = 'This tool is not available right now. Your credits were not charged.';

export function toPublicGenerationStatus(status: GenerationStatus): PublicGenerationStatus {
  if (status === 'needs_reconciliation') return 'processing';
  return status;
}

export function failureMessageFor(reason: string | null | undefined): string {
  if (reason === 'policy') return POLICY_MESSAGE;
  if (
    reason === 'endpoint_not_configured' ||
    reason === 'missing_credentials' ||
    reason === 'source_not_public'
  ) {
    return UNAVAILABLE_MESSAGE;
  }
  return FAILURE_MESSAGE;
}
