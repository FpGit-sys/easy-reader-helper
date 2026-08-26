#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${1:-$repo_dir/deploy/local/.env}"
compose=(docker compose --env-file "$env_file" -f "$repo_dir/docker-compose.local.yml")
"$repo_dir/scripts/local-preflight.sh" "$env_file"
read -r -p "Nome do administrador: " admin_name
read -r -p "E-mail do administrador: " admin_email
read -r -p "Empresa: " organization
read -r -p "Unidade: " facility
read -r -p "Cidade (opcional): " city
read -r -p "Estado (opcional): " state
read -r -s -p "Senha inicial (mínimo 12 caracteres): " SILONR_BOOTSTRAP_PASSWORD
echo
read -r -s -p "Repita a senha: " password_confirmation
echo
[[ "$SILONR_BOOTSTRAP_PASSWORD" == "$password_confirmation" ]] || { echo "As senhas não conferem." >&2; exit 1; }
(( ${#SILONR_BOOTSTRAP_PASSWORD} >= 12 )) || { echo "A senha deve ter ao menos 12 caracteres." >&2; exit 1; }
export SILONR_BOOTSTRAP_PASSWORD SILONR_BOOTSTRAP_CONFIRM=BOOTSTRAP_SILONR_LOCAL
args=(--email "$admin_email" --name "$admin_name" --organization "$organization" --facility "$facility" --trial-days 30)
[[ -n "$city" ]] && args+=(--city "$city")
[[ -n "$state" ]] && args+=(--state "$state")
"${compose[@]}" run --rm -e ALLOW_PUBLIC_SIGNUP=true -e SILONR_BOOTSTRAP_PASSWORD -e SILONR_BOOTSTRAP_CONFIRM migrate bun run scripts/bootstrap-local.ts "${args[@]}"
unset SILONR_BOOTSTRAP_PASSWORD SILONR_BOOTSTRAP_CONFIRM
echo "Administrador criado. O serviço normal continua com cadastro público bloqueado."
