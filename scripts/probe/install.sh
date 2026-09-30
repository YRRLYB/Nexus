#!/bin/sh
set -eu

VERSION=1.8.1
YES=0
DRY_RUN=0
RECONFIGURE=0
SERVER=''
GROUP=''
ALIAS=''
LOCATION=''
PASSWORD_FILE=''
PASSWORD=''
usage() {
    echo 'Usage: sh install.sh [--server HTTPS_REPORT_URL] [--group ID] [--alias NAME] [--location CODE] [--password-file PATH] [--reconfigure] [--dry-run] [--yes]'
}
while [ "$#" -gt 0 ]; do
    case "$1" in
        --server|--group|--alias|--location|--password-file)
            [ "$#" -ge 2 ] || { usage >&2; exit 2; }
            case "$1" in
                --server) SERVER=$2 ;; --group) GROUP=$2 ;; --alias) ALIAS=$2 ;;
                --location) LOCATION=$2 ;; --password-file) PASSWORD_FILE=$2 ;;
            esac
            shift 2 ;;
        --yes) YES=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --reconfigure) RECONFIGURE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

[ "$(uname -s)" = Linux ] || { echo 'Automatic probe deployment supports Linux only.' >&2; exit 1; }
case "$(uname -m)" in
    x86_64|amd64)
        TARGET=x86_64-unknown-linux-musl
        SHA256=aa73a6d1c5e7283fb1cc2f3dbd1a80d4fb0ae8fadd3d5b236a15f32ecf0420a5 ;;
    aarch64|arm64)
        TARGET=aarch64-unknown-linux-musl
        SHA256=5bd675976ae8fcfa82b535702be56a9d721142ebf3eb12fa12de8e79448b8bf0 ;;
    armv7l)
        TARGET=armv7-unknown-linux-musleabihf
        SHA256=dfaadfda892181602e96853db30db58d1c8dc26741f37f3b6a871b95559c2085 ;;
    *) echo 'Supported architectures: x86_64, aarch64, armv7l.' >&2; exit 1 ;;
esac
URL="https://github.com/zdz/ServerStatus-Rust/releases/download/v$VERSION/client-$TARGET.zip"
if [ "$DRY_RUN" -eq 1 ]; then
    printf 'Version: %s\nTarget: %s\nURL: %s\nSHA-256: %s\n' "$VERSION" "$TARGET" "$URL" "$SHA256"
    echo 'Install: /opt/nexus-probe/stat_client; config: /etc/nexus-probe.env; service: nexus-probe.service'
    echo 'No downloads or system changes. Requires Linux, systemd, curl, unzip and sha256sum.'
    exit 0
fi
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo or as root.' >&2; exit 1; }
for dependency in curl unzip sha256sum systemctl install mktemp; do
    command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 1; }
done
[ -d /run/systemd/system ] || { echo 'systemd is required. See docs/PROBE-INSTALL.md for manual deployment.' >&2; exit 1; }
if systemctl is-active --quiet stat_client.service; then
    echo 'An existing stat_client.service is active. Reuse it or stop it deliberately before installing a second probe.' >&2
    exit 1
fi
if [ "$YES" -ne 1 ]; then
    echo 'Install the pinned ServerStatus-Rust client and enable nexus-probe.service.'
    echo 'Existing configuration and persistent node identity are preserved unless --reconfigure is specified.'
    printf 'Type yes to continue: '
    read -r answer
    [ "$answer" = yes ] || { echo 'Cancelled.'; exit 1; }
fi

CONFIG=/etc/nexus-probe.env
WRITE_CONFIG=1
if [ -f "$CONFIG" ] && [ "$RECONFIGURE" -ne 1 ]; then
    WRITE_CONFIG=0
    echo 'Reusing existing /etc/nexus-probe.env (not sourced or printed).'
fi
if [ "$WRITE_CONFIG" -eq 1 ]; then
    ask() {
        current=$1
        label=$2
        fallback=$3
        if [ -n "$current" ]; then printf '%s' "$current"; return; fi
        [ -t 0 ] || { echo "Missing $label; provide arguments for non-interactive deployment." >&2; exit 2; }
        printf '%s [%s]: ' "$label" "$fallback" >&2
        read -r answer
        printf '%s' "${answer:-$fallback}"
    }
    SERVER=$(ask "$SERVER" 'HTTPS report URL' '')
    GROUP=$(ask "$GROUP" 'Group ID' '')
    ALIAS=$(ask "$ALIAS" 'Node alias' "$(hostname)")
    LOCATION=$(ask "$LOCATION" 'Location code' 'us')
    case "$SERVER" in
        https://*) ;;
        *) echo 'Use an HTTPS /report URL. For private HTTP networks, follow the manual installation tutorial.' >&2; exit 2 ;;
    esac
    [ -n "$GROUP" ] || { echo 'Group ID must not be empty.' >&2; exit 2; }
    if [ -n "$PASSWORD_FILE" ]; then
        [ -f "$PASSWORD_FILE" ] && [ "$(wc -c < "$PASSWORD_FILE")" -le 16384 ] || {
            echo 'Invalid password file (maximum 16 KB).' >&2; exit 2;
        }
        PASSWORD=$(cat -- "$PASSWORD_FILE")
    else
        [ -t 0 ] || { echo 'Use --password-file for non-interactive installation.' >&2; exit 2; }
        printf 'Group password (hidden): ' >&2
        terminal_state=$(stty -g)
        trap 'stty "$terminal_state"' EXIT HUP INT TERM
        stty -echo
        read -r PASSWORD
        stty "$terminal_state"
        trap - EXIT HUP INT TERM
        printf '\n' >&2
    fi
    [ -n "$PASSWORD" ] || { echo 'Password must not be empty.' >&2; exit 2; }
    for value in "$SERVER" "$GROUP" "$ALIAS" "$LOCATION" "$PASSWORD"; do
        if printf '%s' "$value" | LC_ALL=C grep '[[:cntrl:]]' >/dev/null; then
            echo 'Configuration cannot contain control characters or newlines.' >&2; exit 2
        fi
    done
fi

workspace=$(mktemp -d)
trap 'rm -f -- "$workspace/client.zip" "$workspace/stat_client" "$workspace/service" "$workspace/config"; rmdir -- "$workspace"' EXIT HUP INT TERM
curl --fail --show-error --location --proto '=https' --tlsv1.2 "$URL" -o "$workspace/client.zip"
printf '%s  %s\n' "$SHA256" "$workspace/client.zip" | sha256sum -c -
unzip -p "$workspace/client.zip" stat_client > "$workspace/stat_client"
chmod 755 "$workspace/stat_client"
[ -s "$workspace/stat_client" ] || { echo 'Empty client binary.' >&2; exit 1; }
install -d -m 755 /opt/nexus-probe
install -m 755 "$workspace/stat_client" /opt/nexus-probe/stat_client.new
mv -f /opt/nexus-probe/stat_client.new /opt/nexus-probe/stat_client
if [ "$WRITE_CONFIG" -eq 1 ]; then
    escape_env() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
    umask 077
    {
        printf 'SSR_ADDR="%s"\n' "$(escape_env "$SERVER")"
        printf 'SSR_GID="%s"\n' "$(escape_env "$GROUP")"
        printf 'SSR_PASS="%s"\n' "$(escape_env "$PASSWORD")"
        printf 'SSR_ALIAS="%s"\n' "$(escape_env "$ALIAS")"
        printf 'SSR_LOC="%s"\n' "$(escape_env "$LOCATION")"
        printf 'SSR_TYPE="kvm"\nSSR_ONLINE="3"\nSSR_INTERVAL="3"\n'
    } > "$workspace/config"
    install -m 600 "$workspace/config" "$CONFIG"
fi
cat > "$workspace/service" <<'UNIT'
[Unit]
Description=Nexus ServerStatus-Rust Probe
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=nexus-probe
WorkingDirectory=/var/lib/nexus-probe
EnvironmentFile=/etc/nexus-probe.env
ExecStart=/opt/nexus-probe/stat_client
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
UNIT
install -m 644 "$workspace/service" /etc/systemd/system/nexus-probe.service
systemctl daemon-reload
systemctl enable nexus-probe.service
systemctl restart nexus-probe.service
sleep 2
systemctl is-active --quiet nexus-probe.service || {
    echo 'Service failed. Diagnose locally: sudo journalctl -u nexus-probe -n 50 --no-pager' >&2; exit 1;
}
echo 'Probe installed and running. Import the node in Nexus using your /json/stats.json URL.'
echo 'Node identity is stored in /var/lib/nexus-probe/.server_status_sys_id and survives upgrades.'
echo 'An active process does not prove server-side authentication succeeded; verify your status page.'
