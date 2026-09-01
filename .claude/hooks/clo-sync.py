#!/usr/bin/env python3
"""Keep a small, local coordination ledger for Claude Code and Codex."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import hashlib
try:
    import fcntl
except ImportError:
    fcntl = None
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR", Path.cwd())).resolve()
SYNC_DIR = ROOT / ".clo-sync"
LEDGER = SYNC_DIR / "activity.md"
MAX_EVENTS = 120
SNAPSHOT = SYNC_DIR / ".snapshot"


def git_lines(*args: str) -> list[str]:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, text=True, capture_output=True, check=False
    )
    return [line for line in result.stdout.splitlines() if line.strip()]


def safe_text(value: object, limit: int = 240) -> str:
    text = " ".join(str(value).replace("\n", " ").split())
    return text[:limit]


def changed_files() -> list[str]:
    files: list[str] = []
    for line in git_lines("status", "--short"):
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path and path not in files:
            files.append(path)
    return files[:20]


def worktree_snapshot() -> str:
    digest = hashlib.sha256()
    for line in git_lines("status", "--short"):
        digest.update(line.encode())
        path = line[3:].strip().split(" -> ")[-1]
        candidate = ROOT / path
        if candidate.is_file():
            try:
                with candidate.open("rb") as handle:
                    digest.update(handle.read(2_000_000))
            except OSError:
                pass
    return digest.hexdigest()


def append_event(actor: str, action: str, detail: str, files: list[str]) -> None:
    SYNC_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    file_text = ", ".join(f"`{item}`" for item in files) if files else "none observed"
    event = f"- {stamp} | **{actor}** | **{action}** | {detail} | files: {file_text}"

    header = (
        "# Clo coordination ledger\n\n"
        "Local, append-only activity shared by Claude Code and Codex. "
        "It records observable actions and file ownership, never private reasoning.\n\n"
        "## Recent activity\n\n"
    )
    with (SYNC_DIR / ".lock").open("w") as lock:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX)
        existing: list[str] = []
        if LEDGER.exists():
            existing = [line for line in LEDGER.read_text().splitlines() if line.startswith("- ")]
        content = header + "\n".join((existing + [event])[-MAX_EVENTS:]) + "\n"

        fd, temp_name = tempfile.mkstemp(dir=SYNC_DIR, prefix="activity-", text=True)
        try:
            with os.fdopen(fd, "w") as handle:
                handle.write(content)
            os.replace(temp_name, LEDGER)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)


def from_hook() -> None:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, OSError):
        return

    tool = safe_text(payload.get("tool_name", "tool"), 40)
    tool_input = payload.get("tool_input") or {}
    snapshot = worktree_snapshot()
    previous = SNAPSHOT.read_text().strip() if SNAPSHOT.exists() else ""
    if tool == "Bash" and snapshot == previous:
        return
    path = tool_input.get("file_path") or tool_input.get("path")
    files = [safe_text(path, 300)] if path else changed_files()
    detail = f"completed {tool}; working tree now has {len(changed_files())} changed file(s)"
    append_event("claude", "observed-change", detail, files)
    SNAPSHOT.write_text(snapshot)


def from_cli(args: list[str]) -> None:
    if len(args) == 2 and args[1] == "context":
        if not LEDGER.exists():
            return
        events = [line for line in LEDGER.read_text().splitlines() if line.startswith("- ")][-8:]
        if events:
            print("<system-reminder>")
            print("Clo coordination update (observable activity only):")
            print("\n".join(events))
            print("Re-read any file claimed or changed by Codex before editing it.")
            print("</system-reminder>")
        return
    if len(args) < 3 or args[1] not in {"begin", "note", "end"}:
        print("usage: clo-sync.py context | begin|note|end codex|claude MESSAGE [FILE ...]", file=sys.stderr)
        raise SystemExit(2)
    action, actor, message, *files = args[1:]
    append_event(safe_text(actor, 30), action, safe_text(message), [safe_text(f, 300) for f in files])
    print(LEDGER)


if __name__ == "__main__":
    if len(sys.argv) == 1:
        from_hook()
    else:
        from_cli(sys.argv)
