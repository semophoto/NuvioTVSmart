#!/usr/bin/env bash
# Fork (semophoto): replay this fork's Tizen fixes onto the latest upstream.
#
#   scripts/fork/update-from-upstream.sh            # onto upstream main
#   scripts/fork/update-from-upstream.sh v1.4.0     # onto a tag or branch
#
# The fork's fixes are a short series of small commits on top of upstream
# (see FORK.md). This rebases that series onto the new upstream, stops on any
# conflict so it can be resolved one fix at a time, then writes the series as
# numbered .patch files to fork-patches/ for machines without GitHub access
# (apply them to a fresh upstream copy with: git am fork-patches/*.patch).
set -euo pipefail

UPSTREAM_URL="https://github.com/NuvioMedia/NuvioTVSmart"
TARGET="${1:-main}"

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$UPSTREAM_URL"
fi
git fetch upstream --tags "$TARGET" 2>/dev/null || git fetch upstream --tags
if git rev-parse -q --verify "upstream/$TARGET" >/dev/null; then
  NEW_BASE="upstream/$TARGET"
else
  NEW_BASE="$TARGET"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has changes; commit or stash them first." >&2
  exit 1
fi

OLD_BASE="$(git merge-base HEAD "$NEW_BASE")"
echo "Replaying $(git rev-list --count "$OLD_BASE"..HEAD) fork commit(s) onto $NEW_BASE"
git rebase --onto "$NEW_BASE" "$OLD_BASE"

rm -rf fork-patches
git format-patch -q "$NEW_BASE"..HEAD -o fork-patches
echo "Done. Patches written to fork-patches/:"
ls fork-patches
echo "Push with: git push --force-with-lease"
