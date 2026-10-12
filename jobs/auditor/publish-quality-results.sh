#!/usr/bin/env bash
# Publish audit-results.json to the storefront data file via the GitHub contents
# API (weekly-audit.yml's publish job).
#
# The payload never goes through argv (#148): the base64 body is written to a
# temp file and sent with `gh api --input`. Passing it as `-f content=...` made
# gh's exec fail with "Argument list too long" once the JSON passed ~128 KiB.
#
# Usage: publish-quality-results.sh <audit-results.json>
# Env:   GH_TOKEN (required by gh), FGS_DATA_REPO / FGS_DATA_PATH (optional overrides)
set -euo pipefail

RESULTS=${1:?usage: publish-quality-results.sh <audit-results.json>}
REPO=${FGS_DATA_REPO:-freegamestore-online/platform}
DATA_PATH=${FGS_DATA_PATH:-sites/freegamestore/data/quality-results.json}
API="repos/$REPO/contents/$DATA_PATH"
MESSAGE="data: weekly quality audit $(date -u +%F)"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

base64 < "$RESULTS" | tr -d '\n' > "$WORK/content.b64"

echo "Fetching current file SHA (if exists)..."
if gh api "$API" > "$WORK/current.json" 2> "$WORK/get.err"; then
  SHA=$(jq -r '.sha // empty' "$WORK/current.json")
  if [ -z "$SHA" ]; then
    echo "::error::GitHub returned no sha for $API; refusing to overwrite blindly." >&2
    exit 1
  fi
elif grep -q 'HTTP 404' "$WORK/get.err"; then
  SHA=""
else
  echo "::error::Could not read $API from GitHub:" >&2
  cat "$WORK/get.err" >&2
  exit 1
fi

jq -n \
  --arg message "$MESSAGE" \
  --rawfile content "$WORK/content.b64" \
  --arg sha "$SHA" \
  '{message: $message, content: $content} + (if $sha == "" then {} else {sha: $sha} end)' \
  > "$WORK/body.json"

echo "Uploading $DATA_PATH to $REPO (sha: ${SHA:-none, creating})..."
if ! gh api -X PUT "$API" --input "$WORK/body.json" > "$WORK/put.json"; then
  echo "::error::PUT $API failed." >&2
  exit 1
fi

echo "Publish complete. Commit: $(jq -r '.commit.sha // "unknown"' "$WORK/put.json")"
