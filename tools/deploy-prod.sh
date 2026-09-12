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

# ── A conflict worth knowing about before it costs an hour ──────────────────
# Installing Docker (for Strix) changes how `supabase functions deploy` works:
# the CLI starts bundling INSIDE a container. colima does not mount /private/tmp
# into its VM, so a deploy run from a git worktree under the scratch directory
# fails with "entrypoint path does not exist" while the file is plainly there.
#
# Two ways out, in order of preference:
#   1. Deploy from a path under $HOME (this repo, or ~/sporv-deploy). The VM
#      mounts $HOME, so the bundler can see the file.
#   2. `colima stop`, deploy, `colima start`. Only if 1 is impossible —
#      it silently disables Strix until someone starts it again.
#
# This does not affect THIS script, which deploys the built static site through
# the Vercel CLI and never touches the Supabase function bundler. It is
# recorded here because this is the file people read when a deploy misbehaves.
# The same production deployment, reachable without the bot challenge.
ALIAS="${PROD_ALIAS:-https://sporv1.vercel.app}"

git fetch -q origin main
WANT=$(git show origin/main:index.html | grep -o 'name="sporve-build" content="[^"]*"' | head -1 |
       sed 's/.*content="\([^"]*\)".*/\1/')
[ -n "$WANT" ] || { echo "could not read the build stamp from origin/main:index.html"; exit 1; }
echo "origin/main  $(git rev-parse --short origin/main)  stamp $WANT"

# Read the build stamp the page is actually serving.
#
# sporv.ai sits behind Vercel's bot challenge: a real browser clears it in about
# a second, but a command-line client gets 403 and an empty body — sometimes.
# Not always, which is worse than never, because it turns verification into a
# coin flip. On 2026-09-09 a test run reported "sporv.ai serves nothing" for a
# build that was live and correct.
#
# So: ask the apex first, and when the challenge eats the response fall back to
# the deployment alias, which is the same deployment and is not challenged.
# Both are reported, so the output never hides which one answered.
stamp_from() {
  curl -s --connect-timeout 10 --max-time 25 "$1" |
    grep -o 'name="sporve-build" content="[^"]*"' | head -1 |
    sed 's/.*content="\([^"]*\)".*/\1/'
}
# Prints "<stamp>|<host that answered>". It has to return BOTH on stdout: a
# command substitution runs in a subshell, so setting a variable inside this
# function would never reach the caller — which is exactly how the first
# version of this fix printed "[read via ]".
live_stamp() {
  local v
  v=$(stamp_from https://sporv.ai)
  [ -n "$v" ] && { printf '%s|%s' "$v" "https://sporv.ai"; return; }
  v=$(stamp_from "$ALIAS")
  [ -n "$v" ] && { printf '%s|%s' "$v" "$ALIAS (sporv.ai answered the bot challenge)"; return; }
  printf '|'
}
# Convenience: set GOT and STAMP_VIA in the CALLER from one probe.
read_live() { local r; r=$(live_stamp); GOT="${r%%|*}"; STAMP_VIA="${r#*|}"; }

# Was it already live before we did anything? This is the difference between
# "this run shipped it" and "nothing needed shipping", and printing the same
# LIVE line for both is how a FAILED MIRROR PUSH once reported success
# (2026-09-09: the bare clone failed, every git -C after it printed "cannot
# change to .../mirror.git", the push never happened, and the script still
# said LIVE because main had not moved).
read_live; BEFORE="$GOT"

echo "→ pushing the mirror (this is what Vercel watches)"
MIRROR_DIR="$SCRATCH/mirror.git"
MIRROR_PUSHED=no
mkdir -p "$SCRATCH"
# Every step checked. A failure here used to be invisible.
if ! git clone -q --bare "$(git remote get-url origin)" "$MIRROR_DIR"; then
  echo "   MIRROR FAILED: could not clone origin into $MIRROR_DIR"
elif ! git -C "$MIRROR_DIR" remote add "$MIRROR_REMOTE" "$MIRROR_URL"; then
  echo "   MIRROR FAILED: could not add the mirror remote"
elif ! git -C "$MIRROR_DIR" fetch -q origin +refs/heads/main:refs/remotes/origin/main; then
  echo "   MIRROR FAILED: could not fetch origin/main"
elif ! git -C "$MIRROR_DIR" push "$MIRROR_REMOTE" refs/remotes/origin/main:refs/heads/main; then
  echo "   MIRROR FAILED: the push to $MIRROR_URL was rejected"
else
  MIRROR_PUSHED=yes
fi

if [ "$MIRROR_PUSHED" = no ]; then
  echo "   the mirror is what Vercel watches, so nothing was deployed by that path."
  if [ "$BEFORE" = "$WANT" ]; then
    # Do not dress this up as a success. The commit happens to be live from an
    # earlier run; this run shipped nothing and the mirror may now be behind.
    echo "NOT DEPLOYED  https://sporv.ai already serves $WANT from an earlier deploy."
    echo "              Fix the mirror push before the next merge, or it will not ship."
    rm -rf "$SCRATCH"
    exit 1
  fi
  echo "   going straight to the direct CLI deploy."
fi

# No point waiting five minutes for a git deploy that was never triggered.
TRIES=30; [ "$MIRROR_PUSHED" = yes ] || TRIES=1
echo "→ waiting for sporv.ai to serve $WANT"
for _ in $(seq 1 $TRIES); do      # up to ~5 minutes when the mirror was pushed
  read_live
  if [ "$GOT" = "$WANT" ]; then
    if [ "$MIRROR_PUSHED" = yes ]; then
      echo "LIVE  https://sporv.ai  $GOT  [read via $STAMP_VIA]"
    else
      echo "LIVE  https://sporv.ai  $GOT  [read via $STAMP_VIA]  (already deployed; this run pushed nothing)"
    fi
    rm -rf "$SCRATCH"; exit 0
  fi
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
  read_live
  [ "$GOT" = "$WANT" ] && { echo "LIVE  https://sporv.ai  $GOT  [read via $STAMP_VIA]"; rm -rf "$SCRATCH"; exit 0; }
  sleep 10
done
echo "STILL NOT LIVE — production serves ${GOT:-nothing}, expected $WANT"
rm -rf "$SCRATCH"
exit 1
