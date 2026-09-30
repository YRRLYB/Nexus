#!/bin/sh
set -eu
YES=0
case "${1:-}" in
    --yes) YES=1 ;;
    -h|--help) echo 'Usage: sh uninstall.sh [--yes] (configuration and node identity are always preserved)'; exit 0 ;;
    '') ;;
    *) echo 'Unknown argument.' >&2; exit 2 ;;
esac
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo or as root.' >&2; exit 1; }
if [ "$YES" -ne 1 ]; then
    printf 'Remove nexus-probe service and binary? Type yes: '
    read -r answer
    [ "$answer" = yes ] || { echo 'Cancelled.'; exit 1; }
fi
systemctl disable --now nexus-probe.service || true
rm -f -- /etc/systemd/system/nexus-probe.service /opt/nexus-probe/stat_client
systemctl daemon-reload
echo 'Removed service and binary. Preserved /etc/nexus-probe.env and /var/lib/nexus-probe for safe reinstall.'
