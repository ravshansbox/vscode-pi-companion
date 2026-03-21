#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${VSCE_TOKEN:-}" ]]; then
  echo "VSCE_TOKEN is required"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required"
  exit 1
fi

branch=$(git symbolic-ref --short HEAD 2>/dev/null || true)
if [[ "$branch" != "main" ]]; then
  echo "Release must be run from main"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean"
  exit 1
fi

npm run compile
npx vsce package >/dev/null
npx vsce publish patch --pat "$VSCE_TOKEN" --skip-duplicate

version=$(node -p "require('./package.json').version")
tag="v$version"

git push origin main --follow-tags

gh release view "$tag" --repo ravshansbox/vscode-pi-companion >/dev/null 2>&1 || \
  gh release create "$tag" --repo ravshansbox/vscode-pi-companion --title "$tag" --generate-notes

echo "Released $tag"
