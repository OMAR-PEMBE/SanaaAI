# Backup and restore

Local development uses the Postgres service in `docker-compose.yml`. Production backups are the host's managed backups once a host exists. This runbook is the manual drill.

Use the database owner URL for dump and restore. The application role `sanaaai_app` is not the owner.

## Dump

```powershell
docker compose exec -T postgres pg_dump -U user -d sanaaai --format=custom --file=/tmp/sanaaai.dump
docker compose cp postgres:/tmp/sanaaai.dump ./sanaaai.dump
```

`sanaaai.dump` is a local artifact. Do not commit it.

## Restore into a scratch database

```powershell
docker compose exec -T postgres psql -U user -d postgres -c "DROP DATABASE IF EXISTS sanaaai_restore;"
docker compose exec -T postgres psql -U user -d postgres -c "CREATE DATABASE sanaaai_restore;"
docker compose cp ./sanaaai.dump postgres:/tmp/sanaaai.dump
docker compose exec -T postgres pg_restore -U user -d sanaaai_restore --no-owner --exit-on-error /tmp/sanaaai.dump
docker compose exec -T postgres psql -U user -d sanaaai_restore -c "SELECT count(*) FROM users;"
docker compose exec -T postgres psql -U user -d postgres -c "DROP DATABASE sanaaai_restore;"
```

Confirm the user count matches the source before dropping the scratch database. Restoring over the live `sanaaai` database is a destructive step and needs an explicit decision. After a restore, run `npm run db:role` so `sanaaai_app` still has insert-only access to `wallet_transactions`.

Last local drill: 2026-10-13. The custom dump restored into `sanaaai_restore` with the same user count as the live database (34). The scratch database and the dump file were then removed. The live `sanaaai` database was not overwritten. Redis and object storage were not part of the dump.

## What a backup does not include

Redis holds the queue and rate-limit counters. It is not the ledger. Object storage (local `storage/` or the S3 bucket) holds the files. A database dump without those files restores the records and not the images.
