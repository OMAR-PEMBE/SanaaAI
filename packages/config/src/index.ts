/** Product display name. Credit prices live in the database, not in this package. */
export const APP_NAME = 'SanaaAI';

/** Ratios verified for Soul 2 text-to-image. Video ratios stay empty until Standard endpoints are verified. */
export const VERIFIED_IMAGE_ASPECT_RATIOS = ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2'] as const;

export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const UPLOAD_MAX_BYTES_DEFAULT = 10 * 1024 * 1024;

export const SIGNED_URL_TTL_DEFAULT_SECONDS = 900;

/** Absolute admin credit change that requires a second confirmation. */
export const ADMIN_ADJUSTMENT_CONFIRM_THRESHOLD = 1000;
