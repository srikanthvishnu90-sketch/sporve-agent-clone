#!/usr/bin/env bash
# Ship origin/main to sporv.ai and prove it landed. Run it by typing:
#
#     bash tools/deploy-prod.sh
#
# WHY THIS EXISTS (2026-09-09). Three merged fixes sat undeployed for hours and
# sporv.ai served a stale build, because production does NOT deploy from this
# repository. The Vercel project `sporv1` (the one that owns the sporv.ai
# domain) has its Git integration pointed at `srikanthvishnu90-sketch/sporve-agent-clone`
# — the mirror. A merge into `sporve-web` deploys NOTHING until the mirror is
# pushed. Verified from the Vercel API: sporv1.link = github
# srikanthvishnu90-sketch/sporve-agent-clone, productionBranch main.
#
# This script does both halves and then checks the live page, so "pushed" and
# "live" can never drift again:
#   1. push origin/main to the mirror (that is what triggers the real deploy)
#   2. wait for sporv.ai to serve the build stamp baked into origin/main
#   3. fall back to a direct CLI deploy of a CLEAN worktree if the git deploy
#      does not land inside the timeout
#
# The fallback deploys a detached worktree at origin/main, never the working
# tree — Codex and Claude share this checkout, and an uncommitted file must
# never reach production.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

MIRROR_REMOTE="${MIRROR_REMOTE:-sporve-agent-clone}"
MIRROR_URL="https://github.com/srikanthvishnu90-sketch/sporve-agent-clone.git"
SCRATCH="${TMPDIR:-/tmp}/sporv-deploy.$$"
VERCEL="./node_modules/.bin/vercel"

git fetch -q origin main
WANT=$(git show origin/main:index.html | grep -o 'name="sporve-build" content="[^"]*"' | head -1 |
       sed 's/.*content="\([^"]*\)".*/\1/')
[ -n "$WANT" ] || { echo "could not read the build stamp from origin/main:index.html"; exit 1; }
echo "origin/main  $(git rev-parse --short origin/main)  stamp $WANT"

echo "→ pushing the mirror (this is what Vercel watches)"
MIRROR_DIR="$SCRATCH/mirror.git"
mkdir -p "$SCRATCH"
git clone -q --bare "$(git remote get-url origin)" "$MIRROR_DIR"
git -C "$MIRROR_DIR" remote add "$MIRROR_REMOTE" "$MIRROR_URL"
git -C "$MIRROR_DIR" fetch -q origin +refs/heads/main:refs/remotes/origin/main
git -C "$MIRROR_DIR" push "$MIRROR_REMOTE" refs/remotes/origin/main:refs/heads/main || true

live_stamp() {
  curl -s --connect-timeout 10 --max-time 25 https://sporv.ai |
    grep -o 'name="sporve-build" content="[^"]*"' | head -1 |
    sed 's/.*content="\([^"]*\)".*/\1/'
}

echo "→ waiting for sporv.ai to serve $WANT"
for _ in $(seq 1 30); do          # up to ~5 minutes
  GOT=$(live_stamp)
  [ "$GOT" = "$WANT" ] && { echo "LIVE  https://sporv.ai  $GOT"; rm -rf "$SCRATCH"; exit 0; }
  sleep 10
done

echo "git deploy did not land (live stamp: ${GOT:-none}) — deploying a clean worktree directly"
[ -x "$VERCEL" ] || npm install --no-save --no-audit --no-fund vercel@latest >/dev/null 2>&1
WT="$SCRATCH/wt"
git worktree add -q --detach "$WT" origin/main
( cd "$WT" && "$OLDPWD/$VERCEL" link --yes --project sporv1 >/dev/null &&
  rm -f .env.local && "$OLDPWD/$VERCEL" deploy --prod --yes >/dev/null ) || {
    echo "direct deploy failed — check 'vercel whoami' and the sporv1 project"; }
git worktree remove --force "$WT" 2>/dev/null

for _ in $(seq 1 18); do
  GOT=$(live_stamp)
  [ "$GOT" = "$WANT" ] && { echo "LIVE  https://sporv.ai  $GOT"; rm -rf "$SCRATCH"; exit 0; }
  sleep 10
done
echo "STILL NOT LIVE — sporv.ai serves ${GOT:-nothing}, expected $WANT"
rm -rf "$SCRATCH"
exit 1
