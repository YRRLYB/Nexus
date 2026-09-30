#!/bin/sh
set -eu
command -v systemctl >/dev/null || { echo 'systemd is required.' >&2; exit 1; }
systemctl status nexus-probe.service --no-pager
echo 'For recent logs: sudo journalctl -u nexus-probe -n 50 --no-pager'
echo 'Inspect credentials locally only; never paste /etc/nexus-probe.env into public issues.'
