import pg from 'pg';

const OWNER = process.env.DATABASE_OWNER_URL ?? 'postgresql://user:password@localhost:5432/sanaaai';
const APP = process.env.DATABASE_URL ?? 'postgresql://sanaaai_app:sanaaai_app@localhost:5432/sanaaai';

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function rejected(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

describe('database constraints', () => {
  it('rejects a negative balance, an empty audit reason, and a duplicate payment reference', async () => {
    await withClient(OWNER, async (client) => {
      const wallet = await client.query<{ id: string; user_id: string }>('SELECT id, user_id FROM wallets LIMIT 1');
      const userId = wallet.rows[0]?.user_id;
      expect(userId).toBeTruthy();

      await client.query('BEGIN');
      try {
        await client.query('UPDATE wallets SET balance_credits = -1 WHERE id = $1', [wallet.rows[0].id]);
        throw new Error('negative balance was accepted');
      } catch (error) {
        expect(rejected(error)).toBe('23514');
      }
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO admin_audit_logs (admin_user_id, action_type, target_type, target_id, reason)
           VALUES ($1, 'user_suspend', 'user', $1, '')`,
          [userId],
        );
        throw new Error('empty reason was accepted');
      } catch (error) {
        expect(rejected(error)).toBe('23514');
      }
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      try {
        const reference = `dup-${Date.now()}`;
        await client.query(
          `INSERT INTO payments (user_id, amount_tzs, credits_granted, snippe_transaction_id)
           VALUES ($1, 2000, 20, $2), ($1, 2000, 20, $2)`,
          [userId, reference],
        );
        throw new Error('duplicate reference was accepted');
      } catch (error) {
        expect(rejected(error)).toBe('23505');
      }
      await client.query('ROLLBACK');
    });
  });

  it('lets the app role insert a ledger row and refuses an update', async () => {
    await withClient(APP, async (client) => {
      const wallet = await client.query<{ id: string; user_id: string }>('SELECT id, user_id FROM wallets LIMIT 1');
      expect(wallet.rows[0]).toBeTruthy();
      await client.query('BEGIN');
      try {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO wallet_transactions
             (wallet_id, user_id, type, amount_credits, balance_after, reference_type, reference_id, description, actor_type)
           VALUES ($1, $2, 'admin_adjustment', 1, 1, 'admin_adjustment', $3, 'constraint probe', 'system')
           RETURNING id`,
          [wallet.rows[0].id, wallet.rows[0].user_id, wallet.rows[0].user_id],
        );
        await client.query('UPDATE wallet_transactions SET description = $2 WHERE id = $1', [
          inserted.rows[0].id,
          'changed',
        ]);
        throw new Error('ledger update was accepted');
      } catch (error) {
        expect(rejected(error)).toBe('42501');
      }
      await client.query('ROLLBACK');
    });
  });
});
