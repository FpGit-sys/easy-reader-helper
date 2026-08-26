#!/usr/bin/env bash
set -euo pipefail
umask 077
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${1:-$repo_dir/deploy/local/.env}"
output="${2:-$repo_dir/silonr-local-diagnostics-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}"
compose=(docker compose --env-file "$env_file" -f "$repo_dir/docker-compose.local.yml")
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
"${compose[@]}" ps >"$work/compose-ps.txt"
docker version >"$work/docker-version.txt"
docker compose version >"$work/compose-version.txt"
df -h >"$work/disk.txt"
"${compose[@]}" logs --since 24h --no-color app caddy 2>&1 | sed -E -e 's/(authorization|cookie|token|password|secret)(["=: ]+)[^ ,"}]+/\1\2[REDACTED]/Ig' -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[EMAIL-REDACTED]/g' >"$work/logs-redacted.txt"
tar -C "$work" -czf "$output" .
echo "Diagnóstico redigido criado em $output"
