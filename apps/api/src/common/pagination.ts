import { ApiError } from './http.js';

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 20;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be an integer from 1 to 100.');
  }
  return value;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: createdAt.toISOString(), id })).toString('base64url');
}

export function decodeCursor(raw: string | undefined): { t: string; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      t?: string;
      id?: string;
    };
    if (!parsed.t || !parsed.id || Number.isNaN(Date.parse(parsed.t))) throw new Error('bad cursor');
    return { t: parsed.t, id: parsed.id };
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The cursor is invalid.');
  }
}

export function cursorFilter(cursor: { t: string; id: string } | null, field = 'createdAt') {
  if (!cursor) return {};
  const at = new Date(cursor.t);
  return {
    OR: [{ [field]: { lt: at } }, { AND: [{ [field]: at }, { id: { lt: cursor.id } }] }],
  };
}

export function pageResult<T extends { id: string }>(
  rows: T[],
  limit: number,
  at: (row: T) => Date,
): { rows: T[]; meta: { nextCursor: string | null; hasMore: boolean } } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    rows: data,
    meta: {
      nextCursor: hasMore && last ? encodeCursor(at(last), last.id) : null,
      hasMore,
    },
  };
}
