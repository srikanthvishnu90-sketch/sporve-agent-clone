#!/usr/bin/env bash
# Re-authorize Codex's Supabase MCP connection. Run it by typing:
#
#     bash tools/codex-supabase-login.sh
#
# WHY THIS SCRIPT EXISTS (diagnosed 2026-09-08)
# `codex mcp login supabase` fails on its own with:
#   Registration failed: HTTP 400 ... scope.1: Invalid option: expected one of
#   "organizations:read"|"projects:read"|"projects:write"|"database:write"|...
# Cause: Codex performs RFC 7591 dynamic client registration and requests every
# scope listed in Supabase's authorization-server metadata
# (https://api.supabase.com/.well-known/oauth-authorization-server advertises 24
# scopes). Supabase's own registration endpoint accepts only 13 of them, and
# rejects analytics:write, analytics_config:*, auth:*, domains:*,
# organizations:write, rest:* and secrets:write. The failing indices in the error
# (1,2,3,4,5,8,9,…) line up exactly with that alphabetical list, so this is a
# Supabase inconsistency, not a Codex bug. Passing an explicit accepted subset
# makes registration succeed.
#
# The eight scopes below are precisely what the read-only MCP resource
# advertises (see .well-known/oauth-protected-resource for the project URL), and
# they cover every tool Codex has enabled: list_tables, list_extensions,
# list_migrations, execute_sql, query_logs, list_edge_functions,
# get_edge_function, get_advisors, get_project_url, generate_typescript_types,
# search_docs. No write scope is requested, so this cannot change the database.
#
# The sporv target is preserved by NOT touching the server URL in
# .codex/config.toml — it stays
#   https://mcp.supabase.com/mcp?project_ref=tseszaprvtvqrkfpditu&read_only=true
set -euo pipefail

SCOPES="organizations:read,projects:read,database:read,analytics:read,secrets:read,edge_functions:read,environment:read,storage:read"

echo "Server target (unchanged):"
codex mcp get supabase | sed -n 's/^  url: /  /p'
echo
echo "Requesting scopes: ${SCOPES//,/ }"
echo "A Supabase authorization page will open in your browser — press Approve."
echo

codex mcp login supabase --scopes "$SCOPES"

# If registration ever fails again, try the client-ID-metadata strategy, which
# skips dynamic registration entirely:
#   codex mcp login supabase --oauth-client-registration cimd --scopes "$SCOPES"
#
# To undo:  codex mcp logout supabase
