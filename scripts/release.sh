#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
if [[ -z "$version" ]]; then
  echo "Usage: ./scripts/release.sh <version>"
  exit 1
fi

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

npm version "$version" --no-git-tag-version
npm run compile
npx vsce publish "$version" --pat "$VSCE_TOKEN" --skip-duplicate --no-git-tag-version

git add package.json package-lock.json
if ! git diff --cached --quiet; then
  git commit -m "$version"
fi

tag="v$version"
git tag -f "$tag"
git push origin main "$tag"

gh release view "$tag" --repo ravshansbox/vscode-pi-companion >/dev/null 2>&1 || \
  gh release create "$tag" --repo ravshansbox/vscode-pi-companion --title "$tag" --generate-notes

echo "Released $tag"
