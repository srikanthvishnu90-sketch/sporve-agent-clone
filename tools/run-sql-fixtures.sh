#!/usr/bin/env bash
# Run the disposable-database SQL fixtures under docs/red-drafts/, each in the
# empty database its own header demands. Never touches production.
#
#     bash tools/run-sql-fixtures.sh                 # every *.test.sql
#     bash tools/run-sql-fixtures.sh 2026-09-08      # only ones matching a filter
#
# WHY THIS EXISTS. Codex's sandbox cannot start PostgreSQL: initdb dies with
# "could not create shared memory segment: Operation not permitted" (System V
# shmget is blocked). Postgres can be told to use mmap instead, and the socket
# directory has to stay under the 103-byte sun_path limit — those two facts are
# the whole trick, and they are baked in below.
#
# Roles are CLUSTER-wide: every fixture does `create role anon` etc, so a second
# fixture fails with "role already exists" unless they are dropped between runs.
# That is why this loops with a clean() step rather than running them in one go.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
FILTER="${1:-}"

PGDATA="${TMPDIR:-/tmp}/sporv-fixture-pg.$$"
SOCK="$HOME/.sporv-pgsock"          # short path: the socket name must fit 103 bytes
trap 'pg_ctl -D "$PGDATA" stop -m fast >/dev/null 2>&1; rm -rf "$PGDATA" "$SOCK"' EXIT

command -v initdb >/dev/null || { echo "initdb not found — brew install postgresql@17"; exit 2; }
rm -rf "$PGDATA" "$SOCK"; mkdir -p "$SOCK"
initdb -D "$PGDATA" -U postgres --auth=trust \
  -c shared_memory_type=mmap -c dynamic_shared_memory_type=posix >/dev/null 2>&1 \
  || { echo "initdb failed"; exit 1; }
pg_ctl -D "$PGDATA" -l "$PGDATA/pg.log" \
  -o "-c shared_memory_type=mmap -c dynamic_shared_memory_type=posix -c listen_addresses='' -k $SOCK" \
  start >/dev/null 2>&1 || { echo "postgres would not start"; tail -5 "$PGDATA/pg.log"; exit 1; }
echo "cluster up — $(psql -X -h "$SOCK" -U postgres -tAc 'select version()' | cut -c1-40)"
echo

pass=0; fail=0; skipped=0
for f in docs/red-drafts/*.test.sql; do
  [ -n "$FILTER" ] && [[ "$f" != *"$FILTER"* ]] && continue
  name=$(basename "$f")
  # The required database name comes from the in-file guard when there is one,
  # otherwise from the `createdb <name>` line in the header comment, otherwise
  # from the file name. A fixture without a guard is still run, but in a
  # database named after itself, so it can never touch anything shared.
  # PROD-ONLY dry runs live in the same directory but assert against the real
  # schema (pg_policies, existing tables). They are not disposable fixtures and
  # must not be run here.
  case "$name" in
    2026-09-08-performance-advisors.test.sql)
      echo "SKIP  $name  (production dry-run, not a disposable fixture)"; skipped=$((skipped+1)); continue;;
  esac
  # A fixture that \ir-includes another one inherits THAT file's required
  # database name — running it under its own name trips the included guard.
  src="$f"
  inc=$(grep -oE '^\\ir[[:space:]]+[A-Za-z0-9._-]+\.test\.sql' "$f" | head -1 | awk '{print $2}')
  [ -n "$inc" ] && [ -f "docs/red-drafts/$inc" ] && src="docs/red-drafts/$inc"
  db=$(grep -oE "current_database\(\)[[:space:]]*<>[[:space:]]*'[a-z_]+'" "$src" | head -1 | sed "s/.*'\(.*\)'/\1/")
  [ -z "$db" ] && db=$(grep -oE "createdb[[:space:]]+[a-z_][a-z0-9_]*" "$src" | head -1 | awk '{print $2}')
  [ -z "$db" ] && db="sporv_fx_$(echo "$name" | tr -cd 'a-z0-9' | tail -c 30)"
  # Wipe EVERY fixture database before dropping the roles. A role that still
  # owns objects anywhere in the cluster cannot be dropped, and the first
  # version of this script only dropped the current database — so every fixture
  # after the first died on "role anon already exists".
  for old in $(psql -X -h "$SOCK" -U postgres -tAc \
      "select datname from pg_database where datname like 'sporv\_%'"); do
    dropdb -h "$SOCK" -U postgres --if-exists "$old" >/dev/null 2>&1
  done
  for r in anon authenticated service_role; do
    psql -X -h "$SOCK" -U postgres -q -c "drop owned by $r cascade" >/dev/null 2>&1
    psql -X -h "$SOCK" -U postgres -q -c "drop role if exists $r" >/dev/null 2>&1
  done
  createdb -h "$SOCK" -U postgres "$db" >/dev/null 2>&1
  log="$PGDATA/$name.log"
  # run from docs/red-drafts so \ir includes resolve
  ( cd docs/red-drafts && psql -X -h "$SOCK" -U postgres -v ON_ERROR_STOP=1 -d "$db" -f "$name" ) >"$log" 2>&1
  rc=$?
  n=$(grep -c "NOTICE:  PASS" "$log")
  if [ $rc -eq 0 ]; then
    echo "PASS  $name  (db=$db, ${n} assertion group(s))"; pass=$((pass+1))
  else
    echo "FAIL  $name  (db=$db, exit $rc)"; grep -E "ERROR" "$log" | head -3 | sed 's/^/        /' | cut -c1-150
    fail=$((fail+1))
  fi
done

echo
echo "fixtures: $pass passed, $fail failed, $skipped skipped"
[ $fail -eq 0 ]
