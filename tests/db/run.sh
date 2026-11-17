#!/usr/bin/env bash
# Database rule tests on a LOCAL PostgreSQL server (never your live Supabase project).
# Usage: PGHOST=localhost PGPORT=5432 PGUSER=postgres bash tests/db/run.sh
# Simulates an existing single-committee database (with payments and a winner),
# upgrades it with migration 04, then checks multi-committee security, lucky draws,
# the public view and WhatsApp credential protection.
# Lines marked "ERROR:" under a heading that says "expect errors" are expected rejections.
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -v ON_ERROR_STOP=1 -q"
psql -q -c "drop database if exists committee_test" -c "create database committee_test"
for f in tests/db/supabase_stub.sql supabase/migrations/2026111100000*.sql supabase/legacy/seed_v1_single_committee.sql tests/db/legacy_data.sql; do
  $P -d committee_test -f "$f" > /dev/null
done
$P -d committee_test -f supabase/migrations/20261117000004_multi_committee.sql > /dev/null
$P -d committee_test -f supabase/migrations/20261117000005_fixes_v2_1.sql > /dev/null
$P -d committee_test -f supabase/migrations/20261117000005_fixes_v2_1.sql > /dev/null  # re-runnable
echo "Upgrade OK"
psql -d committee_test -f tests/db/rules_test.sql
