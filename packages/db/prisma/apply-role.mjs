import pg from 'pg';

const password =
  process.env.DATABASE_APP_PASSWORD ??
  (process.env.NODE_ENV === 'production' ? '' : 'sanaaai_app');

if (!password) {
  console.error('DATABASE_APP_PASSWORD is required when NODE_ENV=production');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const existing = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'sanaaai_app'`);
  const statement = existing.rowCount
    ? 'ALTER ROLE sanaaai_app WITH LOGIN PASSWORD %L'
    : 'CREATE ROLE sanaaai_app LOGIN PASSWORD %L';
  const formatted = await client.query(`SELECT format('${statement}', $1::text) AS stmt`, [password]);
  await client.query(formatted.rows[0].stmt);

  const database = await client.query('SELECT current_database() AS name');
  const name = database.rows[0].name;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error('Unexpected database name.');
  }
  await client.query(`GRANT CONNECT ON DATABASE "${name}" TO sanaaai_app`);
  await client.query('GRANT USAGE ON SCHEMA public TO sanaaai_app');
  await client.query(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sanaaai_app',
  );
  await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sanaaai_app');
  await client.query('REVOKE UPDATE, DELETE ON TABLE wallet_transactions FROM sanaaai_app');
  await client.query('GRANT SELECT, INSERT ON TABLE wallet_transactions TO sanaaai_app');
  await client.query(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sanaaai_app',
  );
} finally {
  await client.end();
}
