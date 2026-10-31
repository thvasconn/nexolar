#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_LOCAL="$SCRIPT_DIR/../.env.local"
if [ -f "$ENV_LOCAL" ]; then
  set -a; source "$ENV_LOCAL"; set +a
fi

HOST_IP="${EXPO_LAN_IP:-${REACT_NATIVE_PACKAGER_HOSTNAME:-}}"
PORT="${EXPO_PORT:-8081}"

if [ -z "$HOST_IP" ]; then
  echo "Missing LAN host IP."
  echo "Set EXPO_LAN_IP to the Windows Wi-Fi/Ethernet IPv4 address before starting Expo."
  echo "Example: EXPO_LAN_IP=192.168.1.23 npm run start:lan"
  exit 1
fi

export REACT_NATIVE_PACKAGER_HOSTNAME="$HOST_IP"
export EXPO_PACKAGER_PROXY_URL="http://$HOST_IP:$PORT"

# Repasse das portas do Supabase local (Docker no WSL mirrored não aparece na rede). Morre junto com o Expo.
node "$SCRIPT_DIR/../../scripts/dev-relay.mjs" &
RELAY_PID=$!
trap 'kill $RELAY_PID 2>/dev/null' EXIT

npx expo start --host lan --port "$PORT" "$@"
