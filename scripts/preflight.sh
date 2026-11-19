#!/usr/bin/env bash
# Fails naming mise run install when a tool a task needs is missing: the node_modules tooling and
# the NATS adapter's packages, which the build reads, with `browser`, the pinned
# chrome-headless-shell, and with `nats`, the pinned nats-server.
# Adapted from spike-html-apps-sdk (df65376): scripts/preflight.sh, with web-components' check of
# the packages the build reads.
set -euo pipefail

fail() {
  echo "preflight: $1 isn't installed; run mise run install" >&2
  exit 1
}

for bin in eslint prettier; do
  [[ -x node_modules/.bin/$bin ]] || fail "$bin (devDependencies)"
done
# The optional peers, which the repository's devDependencies install for the adapter's build.
for package in @nats-io/nats-core @nats-io/jetstream; do
  [[ -f node_modules/$package/package.json ]] || fail "$package (devDependencies)"
done

if [[ "${1:-}" == nats ]]; then
  server=$(mise which nats-server 2>/dev/null) || fail "nats-server"
  pin=$(mise current nats-server)
  if [[ "$("$server" --version)" != "nats-server: v$pin" ]]; then
    echo "preflight: $server isn't nats-server $pin" >&2
    exit 1
  fi
  exit 0
fi

[[ "${1:-}" == browser ]] || exit 0
shell=$(mise which chrome-headless-shell 2>/dev/null) || fail "chrome-headless-shell"
# mise caches downloads by checksum: a version bumped without its sha256 installs the old build.
pin=$(mise current http:chrome-headless-shell)
if [[ "$("$shell" --version)" != *" $pin" ]]; then
  echo "preflight: $shell isn't chrome-headless-shell $pin; give the pin its own sha256" >&2
  exit 1
fi
