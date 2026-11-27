#!/usr/bin/env bash
# Prints `<where>: <item> <pin> -> <latest>` for each mise tool, package.json dependency, GitHub
# Actions pin, and github: devDependency's tag behind its latest, each optional peer's range that
# doesn't admit its package's latest release, each direct requirement and the go directive of
# test/server's Go module behind its latest (the directive against the latest Go minor), and the
# resumable-upload draft revision src/upload.ts implements when datatracker names a later revision
# or the RFC the draft became; and exits 1 if any; prints nothing when all are current. Reads the
# network.
set -euo pipefail
cd "$(dirname "$0")/.."

trailing=""

report() {
  trailing+=$'\n'"$1"
}

report_mise_tools() {
  local outdated lines
  outdated=$(MISE_LOG_LEVEL=error mise outdated --bump --local --json) || return
  lines=$(node -p '
    Object.entries(JSON.parse(process.argv[1]))
      .map(([tool, { requested, bump }]) => "mise.toml: " + [tool, requested, "->", bump].join(" "))
      .join("\n")
  ' "$outdated") || return
  [[ -z $lines ]] || report "$lines"
}

report_github_tag() {
  local package=$1 pin=$2 spec latest
  spec=${pin#github:}
  latest=$(gh api "repos/${spec%%#*}/releases/latest" --jq .tag_name) || return
  if [[ ${spec#*#} != "$latest" ]]; then
    report "package.json: $package ${spec#*#} -> $latest"
  fi
}

typescript_eslint_accepted_typescript() {
  local typescript_eslint range accepted
  typescript_eslint=$(node -p 'require("./package.json").devDependencies["typescript-eslint"]') ||
    return
  range=$(pnpm view "typescript-eslint@$typescript_eslint" peerDependencies.typescript) || return
  accepted=$(pnpm view "typescript@$range" version --json) || return
  node -p '[].concat(JSON.parse(process.argv[1])).join("\n")' "$accepted" | sort -V | tail -n 1
}

report_peer_range() {
  local package=$1 latest=$2 range
  range=$(node -p 'require("./package.json").peerDependencies?.[process.argv[1]] ?? ""' \
    "$package") || return
  if [[ -n $range ]] && ! node --input-type=module -e '
    import { caretAdmits } from "./test/unit/release.ts";
    process.exit(caretAdmits(...process.argv.slice(1)) ? 0 : 1);
  ' "$range" "$latest"; then
    report "package.json: peer $package $range -> ^$latest"
  fi
}

report_packages() {
  local pins package pin latest
  pins=$(node -p '
    const { dependencies, devDependencies } = require("./package.json");
    Object.entries({ ...dependencies, ...devDependencies })
      .map(([name, pin]) => name + " " + pin)
      .join("\n")
  ') || return
  while read -r package pin; do
    if [[ $pin == github:* ]]; then
      report_github_tag "$package" "$pin"
      continue
    fi
    if [[ $package == typescript ]]; then
      latest=$(typescript_eslint_accepted_typescript) || return
    else
      latest=$(pnpm view "$package" version) || return
    fi
    if [[ $pin != "$latest" ]]; then
      report "package.json: $package $pin -> $latest"
    fi
    report_peer_range "$package" "$latest"
  done <<<"$pins"
}

report_actions() {
  local uses action repo latest
  uses=$(grep -ho 'uses: *[^ ]*@[^ ]*' .github/workflows/*.yml | sed 's/uses: *//' | sort -u) ||
    return
  while read -r action; do
    repo=$(cut -d/ -f1,2 <<<"${action%@*}") || return
    latest=$(gh api "repos/$repo/releases/latest" --jq .tag_name) || return
    if [[ ${action#*@} != "$latest" ]]; then
      report ".github/workflows: ${action%@*} ${action#*@} -> $latest"
    fi
  done <<<"$uses"
}

report_go_module() {
  local mod=test/server updates line latest directive
  updates=$(GOWORK=off go -C "$mod" list -m -u -f \
    '{{if and (not .Main) (not .Indirect) .Update}}{{.Path}} {{.Version}} -> {{.Update.Version}}{{end}}' \
    all) || return
  while read -r line; do
    [[ -z $line ]] || report "$mod/go.mod: $line"
  done <<<"$updates"
  latest=$(mise latest go | cut -d. -f1,2) || return
  directive=$(GOWORK=off go -C "$mod" mod edit -json |
    node -p 'JSON.parse(require("fs").readFileSync(0)).Go' | cut -d. -f1,2) || return
  if [[ $directive != "$latest" ]]; then
    report "$mod/go.mod: go $directive -> go $latest"
  fi
}

report_upload_draft() {
  local source=src/upload.ts draft=draft-ietf-httpbis-resumable-upload pin doc latest
  pin=$(sed -n 's/^export const DRAFT_REVISION = \([0-9][0-9]*\);$/\1/p' "$source")
  if [[ -z $pin ]]; then
    echo "$source: no DRAFT_REVISION constant" >&2
    exit 1
  fi
  doc=$(curl -fsS "https://datatracker.ietf.org/doc/$draft/doc.json") || return
  latest=$(node -p '
    const { rev, rfc } = JSON.parse(process.argv[1]);
    rfc ? "RFC " + rfc : rev
  ' "$doc") || return
  if [[ $latest != "$pin" ]]; then
    report "$source: $draft $pin -> $latest"
  fi
}

report_mise_tools
report_packages
report_actions
report_go_module
report_upload_draft

if [[ -n ${trailing//$'\n'/} ]]; then
  sed '/^$/d' <<<"$trailing"
  exit 1
fi
