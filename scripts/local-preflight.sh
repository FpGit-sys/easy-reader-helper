#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${1:-$repo_dir/deploy/local/.env}"

if [[ ! -f "$env_file" ]]; then
  echo "Arquivo de configuração ausente: $env_file" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

required=(SILONR_LOCAL_SERVER POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD BETTER_AUTH_SECRET MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY LOCAL_BACKUP_DIR)
for key in "${required[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Variável obrigatória ausente: $key" >&2
    exit 1
  fi
done

python3 - "$SILONR_LOCAL_SERVER" "${SILONR_LOCAL_ALLOW_LOOPBACK:-false}" <<'PY'
import ipaddress
import sys
address = ipaddress.ip_address(sys.argv[1])
allow_loopback = sys.argv[2].lower() == "true"
if address.version != 4:
    raise SystemExit("SILONR_LOCAL_SERVER deve ser IPv4")
if address.is_loopback and allow_loopback:
    raise SystemExit(0)
if not address.is_private or address.is_loopback or address.is_link_local:
    raise SystemExit("SILONR_LOCAL_SERVER deve ser um IPv4 privado fixo da LAN")
PY

if [[ "$LOCAL_BACKUP_DIR" != /* ]]; then
  echo "LOCAL_BACKUP_DIR deve ser um caminho absoluto." >&2
  exit 1
fi

secrets=(POSTGRES_PASSWORD BETTER_AUTH_SECRET MINIO_ROOT_PASSWORD S3_SECRET_ACCESS_KEY)
for key in "${secrets[@]}"; do
  value="${!key}"
  if (( ${#value} < 24 )) || [[ "$value" == *replace-* ]]; then
    echo "$key deve ter ao menos 24 caracteres aleatórios e não pode usar o exemplo." >&2
    exit 1
  fi
done
if [[ "$POSTGRES_PASSWORD" == "$MINIO_ROOT_PASSWORD" || "$POSTGRES_PASSWORD" == "$S3_SECRET_ACCESS_KEY" || "$MINIO_ROOT_PASSWORD" == "$S3_SECRET_ACCESS_KEY" ]]; then
  echo "As senhas de banco, MinIO e aplicação devem ser diferentes." >&2
  exit 1
fi
if [[ "$MINIO_ROOT_USER" == "$S3_ACCESS_KEY_ID" ]]; then
  echo "O usuário raiz do MinIO não pode ser o usuário da aplicação." >&2
  exit 1
fi

config="$(docker compose --env-file "$env_file" -f "$repo_dir/docker-compose.local.yml" config --format json)"
python3 - "$config" <<'PY'
import json
import sys
cfg = json.loads(sys.argv[1])
services = cfg["services"]
for name in ("postgres", "minio", "app", "migrate"):
    if services[name].get("ports"):
        raise SystemExit(f"{name} não pode publicar portas")
ports = services["caddy"].get("ports", [])
targets = sorted(int(p["target"]) for p in ports)
if targets != [443, 9443]:
    raise SystemExit("Somente as portas TLS 443 e 9443 podem ser publicadas")
networks = cfg.get("networks", {})
if not networks.get("backend", {}).get("internal"):
    raise SystemExit("A rede backend deve permanecer interna")
for name in ("app", "migrate"):
    env = services[name]["environment"]
    if env.get("NODE_ENV") != "production":
        raise SystemExit(f"{name} deve executar em produção")
    if env.get("ALLOW_PUBLIC_SIGNUP") != "false":
        raise SystemExit("Cadastro público deve permanecer desabilitado")
    if env.get("DEPLOYMENT_MODE") != "local":
        raise SystemExit("DEPLOYMENT_MODE deve ser local")
PY

echo "Preflight local aprovado para https://$SILONR_LOCAL_SERVER"
