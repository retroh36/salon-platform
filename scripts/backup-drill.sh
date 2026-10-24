#!/usr/bin/env bash
# Backup drill (docs/operations.md): dumps the local database the way a
# backup would (the app's schemas: public, private, auth, storage), restores
# it into a scratch database, and checks every table came back with the
# same number of rows. Prints table names and counts only, never data.
# Needs local Supabase running (npx supabase start).
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_salon-platform}"
SCHEMAS="public private auth storage"
psql_in() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -At "$@"; }

echo "Dumping…"
docker exec "$CONTAINER" pg_dump -U postgres -d postgres -Fc $(printf -- '-n %s ' $SCHEMAS) -f /tmp/backup-drill.dump
size=$(docker exec "$CONTAINER" stat -c %s /tmp/backup-drill.dump)
echo "Dump: $((size / 1024)) KB"

echo "Restoring into a scratch database…"
psql_in -d postgres -qc "set client_min_messages = warning" -c "drop database if exists backup_drill" -c "create database backup_drill"
psql_in -d backup_drill -q <<'SQL'
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gin with schema extensions;
create extension if not exists btree_gist with schema extensions;
drop schema if exists public cascade;
SQL
# Supabase's own default privileges can't be restored by a plain role; the
# data and schema can. Anything else failing is a real problem.
errors=$(docker exec "$CONTAINER" pg_restore -U postgres -d backup_drill --no-owner /tmp/backup-drill.dump 2>&1 | grep "ERROR" | grep -v "permission denied to change default privileges" || true)
if [ -n "$errors" ]; then
  echo "Restore errors:"
  echo "$errors" | sed 's/ at character.*//' | sort | uniq -c
  exit 1
fi

count_sql="select n.nspname || '.' || c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'private', 'auth', 'storage') order by 1"
# And what makes it usable: row level security, its policies, and the
# database functions every change goes through.
shape_sql="select 'rls tables|' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relrowsecurity and n.nspname = 'public'
  union all select 'policies|' || count(*) from pg_policies where schemaname in ('public', 'storage')
  union all select 'functions|' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
  union all select 'triggers|' || count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname = 'public'"
{ psql_in -d postgres -c "$count_sql"; psql_in -d postgres -c "$shape_sql"; } > /tmp/backup-drill-before.txt
{ psql_in -d backup_drill -c "$count_sql"; psql_in -d backup_drill -c "$shape_sql"; } > /tmp/backup-drill-after.txt
psql_in -d postgres -qc "drop database backup_drill"
docker exec "$CONTAINER" rm -f /tmp/backup-drill.dump

tables=$(grep -c '\.' /tmp/backup-drill-before.txt)
rows=$(grep '\.' /tmp/backup-drill-before.txt | awk -F'|' '{ n += $2 } END { print n }')
if diff /tmp/backup-drill-before.txt /tmp/backup-drill-after.txt > /tmp/backup-drill-diff.txt; then
  echo "Backup drill passed: $tables tables, $rows rows, all restored."
  for t in public.clients public.appointments public.sales public.payments public.gift_cards auth.users storage.objects "rls tables" policies functions; do
    grep "^$t|" /tmp/backup-drill-after.txt | sed 's/|/: /'
  done
else
  echo "Backup drill FAILED: these tables came back different (before < > after):"
  cat /tmp/backup-drill-diff.txt
  exit 1
fi
