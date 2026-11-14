#!/usr/bin/env bash
# Runs the database rule tests on a LOCAL PostgreSQL server (never on your live Supabase project).
# Usage: PGHOST=localhost PGPORT=5432 PGUSER=postgres bash tests/db/run.sh
# Creates (and drops) a database called committee_test. Output shows each test; errors marked
# "ERROR:" under a test heading are EXPECTED rejections (e.g. over-payment blocked).
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -v ON_ERROR_STOP=1 -q"
psql -q -c "drop database if exists committee_test" -c "create database committee_test"
for f in tests/db/supabase_stub.sql supabase/migrations/*.sql supabase/seed.sql; do
  $P -d committee_test -f "$f" > /dev/null
done
echo "Schema + seed OK"
psql -d committee_test -f tests/db/rules_test.sql
