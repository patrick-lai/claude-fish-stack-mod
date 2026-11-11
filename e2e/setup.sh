#!/usr/bin/env bash
# Builds the end-to-end fixture: a bare origin and a clone of it holding a
# small JSON API and its openapi.json, with a lockfile; plus settings that
# make Autopilot quick and keep an installed fishStack out of the way.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="${FISH_E2E:-${TMPDIR%/}/fish-e2e}"

rm -rf "$root"
mkdir -p "$root"
git init -q --bare -b main "$root/origin.git"
git clone -q "$root/origin.git" "$root/app" 2>/dev/null

cp "$here/fixture/server.js" "$here/fixture/openapi.json" "$root/app/"
cat > "$root/app/README.md" <<'MD'
# Workshop API

A tiny JSON API: `node server.js` serves /items on $COMMISSION_DEV_PORT.
MD
printf '{ "name": "workshop-api", "private": true }\n' > "$root/app/package.json"
printf '{ "name": "workshop-api", "lockfileVersion": 3 }\n' > "$root/app/package-lock.json"
printf 'node_modules/\n' > "$root/app/.gitignore"
git -C "$root/app" add -A
git -C "$root/app" -c user.name=fish -c user.email=fish@example.com commit -q -m "Workshop API"
git -C "$root/app" push -q origin main

cat > "$root/settings.json" <<JSON
{
  "enabledPlugins": { "fishstack@claude-fish-stack-mod": false },
  "pluginConfigs": {
    "fishstack": { "options": { "autoAnswerMinutes": 0.1 } },
    "fishstack@inline": { "options": { "autoAnswerMinutes": 0.1 } }
  }
}
JSON

echo "$root"
