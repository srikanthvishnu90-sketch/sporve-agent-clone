#!/usr/bin/env python3
"""Report the four authoritative business-gate statuses from GATES.md."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
GATES_PATH = ROOT / "GATES.md"
EXPECTED_IDS = ["G1", "G2", "G3", "G4"]


def fail(message: str) -> None:
    print(f"gate status: FAIL — {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_gates(source: str) -> list[dict[str, object]]:
    matches = list(
        re.finditer(
            r"(?ms)^## (G[1-4]) — ([^\n]+)\n\n\*\*Status: (TRUE|FALSE)\.\*\*(.*?)(?=^---$|^## Rules for every agent|\Z)",
            source,
        )
    )
    ids = [match.group(1) for match in matches]
    if ids != EXPECTED_IDS:
        fail(f"expected {EXPECTED_IDS} in order, found {ids}")

    gates: list[dict[str, object]] = []
    for match in matches:
        body = match.group(4)
        if "**Done looks like:**" not in body:
            fail(f"{match.group(1)} is missing its exact Done looks like clause")
        status = match.group(3)
        gates.append(
            {
                "id": match.group(1),
                "title": match.group(2),
                "status": status,
                "passed": status == "TRUE",
            }
        )
    return gates


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, help="also write the JSON report to this path")
    args = parser.parse_args()

    if not GATES_PATH.is_file():
        fail("GATES.md is missing")
    source = GATES_PATH.read_text(encoding="utf-8")
    if "Four gates. Nothing else counts as progress." not in source:
        fail("GATES.md no longer declares the sole progress definition")
    if "reported as NOTHING MOVED" not in source:
        fail("GATES.md no longer defines the no-movement report")

    gates = parse_gates(source)
    passed_count = sum(bool(gate["passed"]) for gate in gates)
    report = {
        "schema_version": 1,
        "source": "GATES.md",
        "authoritative_progress_definition": True,
        "gates": gates,
        "passed_count": passed_count,
        "total_count": len(gates),
        "progress_statement": "NOTHING MOVED" if passed_count == 0 else f"{passed_count}/4 GATES TRUE",
        "note": "Feature scores, test counts, commit volume, and analysis are supporting evidence only.",
    }
    rendered = json.dumps(report, indent=2) + "\n"
    print(rendered, end="")
    if args.output:
        output = args.output if args.output.is_absolute() else ROOT / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
