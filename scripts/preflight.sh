#!/usr/bin/env bash
# Fails naming mise run install when a tool a task needs is missing: the node_modules tooling and
# the NATS adapter's packages, which the build reads, with `browser`, the pinned
# chrome-headless-shell, and with `nats`, the pinned nats-server.
# Adapted from spike-html-apps-sdk (df65376): scripts/preflight.sh, with the checks below added.
# Adapted from web-components (a659353): scripts/preflight.sh, its tool and browser checks.
set -euo pipefail

fail() {
  echo "preflight: $1 isn't installed; run mise run install" >&2
  exit 1
}

require_node_modules() {
  local bin package
  for bin in eslint prettier; do
    [[ -x node_modules/.bin/$bin ]] || fail "$bin (devDependencies)"
  done
  for package in @nats-io/nats-core @nats-io/jetstream; do
    [[ -f node_modules/$package/package.json ]] || fail "$package (devDependencies)"
  done
}

require_nats_server_at_pin() {
  local server pin version
  server=$(mise which nats-server 2>/dev/null) || fail "nats-server"
  pin=$(mise current nats-server) || return
  version=$("$server" --version) || return
  if [[ $version != "nats-server: v$pin" ]]; then
    echo "preflight: $server isn't nats-server $pin" >&2
    exit 1
  fi
}

require_browser_at_pin() {
  local shell pin version
  shell=$(mise which chrome-headless-shell 2>/dev/null) || fail "chrome-headless-shell"
  pin=$(mise current http:chrome-headless-shell) || return
  version=$("$shell" --version) || return
  if [[ $version != *" $pin" ]]; then
    echo "preflight: $shell isn't chrome-headless-shell $pin; give the pin its own sha256" >&2
    exit 1
  fi
}

require_node_modules
case "${1:-}" in
  nats) require_nats_server_at_pin ;;
  browser) require_browser_at_pin ;;
esac
