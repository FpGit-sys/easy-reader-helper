#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "Run as root: sudo ./ops/install-pilot-systemd.sh" >&2; exit 1; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/deploy/pilot/.env"
[[ -f "$env_file" ]] || { echo "Missing $env_file" >&2; exit 1; }

install -d -m 0700 /var/lib/silonr-monitor /var/backups/silonr/postgres /var/backups/silonr/evidence

write_service() {
  local name="$1" command="$2"
  tee "/etc/systemd/system/$name.service" >/dev/null <<EOF
[Unit]
Description=SiloNR $name
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$repo_root
Environment=SILONR_ENV_FILE=$env_file
ExecStart=/usr/bin/bash $repo_root/ops/$command
User=root
NoNewPrivileges=true
PrivateTmp=true
EOF
}

write_timer() {
  local name="$1" schedule="$2"
  tee "/etc/systemd/system/$name.timer" >/dev/null <<EOF
[Unit]
Description=Schedule SiloNR $name

[Timer]
$schedule
Persistent=true
Unit=$name.service

[Install]
WantedBy=timers.target
EOF
}

write_service silonr-monitor pilot-monitor.sh
write_timer silonr-monitor $'OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s'
write_service silonr-backup pilot-backup.sh
write_timer silonr-backup $'OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=10min'
write_service silonr-restore-drill pilot-restore-drill.sh
write_timer silonr-restore-drill $'OnCalendar=Sun *-*-* 04:30:00
RandomizedDelaySec=20min'

systemctl daemon-reload
systemctl enable --now silonr-monitor.timer silonr-backup.timer silonr-restore-drill.timer
systemctl list-timers 'silonr-*'
echo "SiloNR monitor, backup and restore-drill timers installed."
