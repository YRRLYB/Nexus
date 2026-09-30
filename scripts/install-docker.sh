#!/bin/sh
set -eu

YES=0
DRY_RUN=0
for argument in "$@"; do
    case "$argument" in
        --yes) YES=1 ;;
        --dry-run) DRY_RUN=1 ;;
        -h|--help) printf '%s\n' 'Usage: sh install-docker.sh [--dry-run] [--yes]'; exit 0 ;;
        *) printf 'Unknown argument: %s\n' "$argument" >&2; exit 2 ;;
    esac
done

[ "$(uname -s)" = Linux ] || { echo 'Linux only. Use Docker Desktop on Windows/macOS.' >&2; exit 1; }
[ -r /etc/os-release ] || { echo '/etc/os-release is required.' >&2; exit 1; }
. /etc/os-release
case "$ID" in
    debian|ubuntu|fedora|centos|rhel|raspbian|alpine) ;;
    *) echo "Unsupported distribution: $ID. Follow Docker official installation instructions." >&2; exit 1 ;;
esac
if command -v docker >/dev/null 2>&1; then
    docker --version
    echo 'Docker is already installed. No changes made; this is not an upgrade script.'
    exit 0
fi
if [ "$DRY_RUN" -eq 1 ]; then
    echo "Plan: install Docker on $ID using the official convenience script (Alpine: apk docker docker-cli-compose)."
    echo 'No files, packages, users, firewall rules or services changed.'
    exit 0
fi
if [ "$YES" -ne 1 ]; then
    echo 'This installs packages and starts the Docker daemon. Docker has root-level access.'
    echo 'The upstream convenience script is intended for development/test machines, not production upgrades.'
    printf 'Type yes to continue: '
    read -r answer
    [ "$answer" = yes ] || { echo 'Cancelled.'; exit 1; }
fi
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo or as root.' >&2; exit 1; }

if [ "$ID" = alpine ]; then
    apk add --no-cache docker docker-cli-compose
    command -v rc-update >/dev/null && command -v rc-service >/dev/null || {
        echo 'OpenRC is not available. Docker installed, but daemon must be started manually.' >&2; exit 1;
    }
    rc-update add docker default
    rc-service docker start
else
    command -v curl >/dev/null || { echo 'Install curl first using your package manager.' >&2; exit 1; }
    workspace=$(mktemp -d)
    trap 'rm -f -- "$workspace/get-docker.sh"; rmdir -- "$workspace"' EXIT HUP INT TERM
    curl --fail --show-error --location --proto '=https' --tlsv1.2 https://get.docker.com -o "$workspace/get-docker.sh"
    sh "$workspace/get-docker.sh" --dry-run
    if [ "$YES" -ne 1 ]; then
        printf 'Review the plan above. Type yes to apply: '
        read -r answer
        [ "$answer" = yes ] || { echo 'Cancelled.'; exit 1; }
    fi
    sh "$workspace/get-docker.sh"
    command -v systemctl >/dev/null && [ -d /run/systemd/system ] || {
        echo 'Docker installed. This system has no systemd; start the daemon manually.' >&2; exit 1;
    }
    systemctl enable --now docker
fi
docker version
docker compose version
echo 'Docker installed. No users added to the docker group; no firewall rules changed.'
