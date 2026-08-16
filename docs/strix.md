# Strix — the every-10-prompts deep security pass

**What it is.** Strix (`usestrix/strix`) is an open-source AI pentester: autonomous
agents that dynamically test code, find vulnerabilities, and *validate them with a
real proof-of-concept exploit* rather than guessing from static patterns. It is a
separate agent from Clo. Clo's `MODE: pentest` is the always-available static
triage; Strix is the deep pass Clo activates on a cadence and then triages.

**What it scans.** Not `the-sporve-web` — that is one static HTML file with no
server, no database, no user input; a scanner finds nothing here. The real attack
surface is the **backend**: `~/SportsMan-main` (SQL migrations, edge functions, RLS
policies, Stripe webhooks, the ai-gateway) plus the live Supabase project. The
runner defaults its target to `~/SportsMan-main`.

**Authorization.** This is the owner's own codebase and infrastructure —
authorized security testing. The runner refuses any target that is not
owner-owned, passes `--headless`, and never points at production data. It produces
**findings only**: it never writes code, opens a PR, or applies a fix. That keeps
the scheduled activation inside the read-only rail for unattended agents.

## How the cadence works

1. `.claude/hooks/clo-nudge.sh` (a `UserPromptSubmit` hook) counts real user
   prompts in `.clo-sync/strix-counter` — background-agent notifications don't
   count.
2. Every 10th prompt it injects a `STRIX DUE` reminder into the turn.
3. The in-session agent (or Clo) runs `bash tools/strix-scan.sh`. If Strix's
   preconditions are unmet, it falls back to Clo `MODE: pentest` static triage and
   tells you setup is still pending.
4. Findings land in `strix_runs/` (git-ignored — PoC detail stays local) and a
   one-line summary is appended to `.clo-sync/activity.md`.

## Owner one-time setup (exact steps)

The runner stays *staged* — it prints what's missing and exits — until all three
are done:

1. **Docker.** Open **Docker Desktop** and wait for the whale icon to go steady
   (or run `colima start`). Strix runs its agents in a Docker sandbox.
2. **Install Strix.** In Terminal:
   ```
   pipx install strix-agent
   ```
   (No pipx? `brew install pipx && pipx ensurepath`, then reopen Terminal. Or
   `pip3 install --user strix-agent`.)
3. **Give Strix its own key.** Strix needs an Anthropic key *you* control — NOT
   the service-role ai-gateway key, which is never handed to a client-side tool.
   Add to your shell profile (`~/.zshrc`), then reopen Terminal:
   ```
   export STRIX_LLM='anthropic/claude-opus-4-8'
   export LLM_API_KEY='sk-ant-...'
   ```

**First run** (from `~/the-sporve-web`):
```
bash tools/strix-scan.sh
```
View the dashboard afterward with `strix view`.
