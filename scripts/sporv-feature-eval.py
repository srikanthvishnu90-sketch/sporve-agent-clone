#!/usr/bin/env python3
"""Validate and summarize Sporv's evidence-backed 87-feature catalogue."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any, Dict, Iterable, List, Optional


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / "evals" / "sporv-product-audit" / "feature-catalog.json"

DOMAIN_RANGES = {
    "AI Assistant": range(1, 13),
    "Messaging & Communication": range(13, 24),
    "Booking & Marketplace": range(24, 35),
    "Payments & Money": range(35, 48),
    "Scheduling & Calendar": range(48, 56),
    "Client & Roster": range(56, 64),
    "Coach & Staff Operations": range(64, 72),
    "Video & Development": range(72, 78),
    "Commerce & Gear": range(78, 81),
    "Analytics & Growth": range(81, 85),
    "Onboarding & Migration": range(85, 88),
}

CLASSIFICATIONS = {
    "live_verified",
    "implemented_unverified",
    "demo_only",
    "spec_only",
    "absent",
    "blocked",
}

LOCAL_EVIDENCE_KINDS = {"source", "test", "doc"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--previous", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: top level must be an object")
    return value


def local_path(ref: str) -> Path:
    clean = ref.split("#", 1)[0]
    return ROOT / clean


def band(score: int) -> str:
    if score >= 9:
        return "near_ready"
    if score >= 7:
        return "working"
    if score >= 4:
        return "partial"
    return "not_built"


def average(values: Iterable[int]) -> float:
    numbers = list(values)
    return round(sum(numbers) / len(numbers), 2) if numbers else 0.0


def validate_feature(feature: Dict[str, Any], errors: List[str]) -> None:
    required = {
        "id", "domain", "feature", "score", "classification", "evidence",
        "blocker", "next_move", "confidence",
    }
    missing = sorted(required - set(feature))
    feature_id = feature.get("id", "?")
    if missing:
        errors.append(f"feature {feature_id}: missing {', '.join(missing)}")
        return

    score = feature["score"]
    classification = feature["classification"]
    if not isinstance(score, int) or not 0 <= score <= 10:
        errors.append(f"feature {feature_id}: score must be an integer 0..10")
    if classification not in CLASSIFICATIONS:
        errors.append(f"feature {feature_id}: unknown classification {classification!r}")
    if feature["confidence"] not in {"high", "medium", "low"}:
        errors.append(f"feature {feature_id}: confidence must be high, medium, or low")

    ceilings = {"absent": 1, "spec_only": 3, "demo_only": 4, "implemented_unverified": 8}
    if classification in ceilings and isinstance(score, int) and score > ceilings[classification]:
        errors.append(
            f"feature {feature_id}: {classification} score {score} exceeds ceiling {ceilings[classification]}"
        )
    if score == 10 and (classification != "live_verified" or feature["confidence"] != "high"):
        errors.append(f"feature {feature_id}: a 10 requires live_verified with high confidence")

    evidence = feature["evidence"]
    if not isinstance(evidence, list) or not evidence:
        errors.append(f"feature {feature_id}: at least one evidence item is required")
        return
    evidence_kinds = set()
    for index, item in enumerate(evidence):
        if not isinstance(item, dict) or set(item) != {"kind", "ref"}:
            errors.append(f"feature {feature_id}: evidence {index} must contain only kind and ref")
            continue
        kind, ref = item["kind"], item["ref"]
        evidence_kinds.add(kind)
        if kind not in {"source", "test", "doc", "live", "agent"}:
            errors.append(f"feature {feature_id}: evidence {index} has unknown kind {kind!r}")
        if not isinstance(ref, str) or not ref.strip():
            errors.append(f"feature {feature_id}: evidence {index} ref is empty")
        elif kind in LOCAL_EVIDENCE_KINDS and not local_path(ref).exists():
            errors.append(f"feature {feature_id}: evidence path does not exist: {ref}")
    if isinstance(score, int) and score >= 7 and not ({"test", "live"} & evidence_kinds):
        errors.append(f"feature {feature_id}: score >=7 requires test or live evidence")


def main() -> int:
    args = parse_args()
    try:
        catalog = load_json(args.catalog)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"feature catalogue error: {error}", file=sys.stderr)
        return 2

    features = catalog.get("features")
    errors: List[str] = []
    if not isinstance(features, list):
        errors.append("features must be an array")
        features = []
    if len(features) != 87:
        errors.append(f"catalogue must contain exactly 87 features, found {len(features)}")

    ids = [feature.get("id") for feature in features if isinstance(feature, dict)]
    if ids != list(range(1, 88)):
        errors.append("feature ids must be unique, ordered, and exactly 1..87")

    expected_domains = {
        feature_id: domain
        for domain, feature_ids in DOMAIN_RANGES.items()
        for feature_id in feature_ids
    }
    for feature in features:
        if not isinstance(feature, dict):
            errors.append("every feature must be an object")
            continue
        validate_feature(feature, errors)
        feature_id = feature.get("id")
        if expected_domains.get(feature_id) != feature.get("domain"):
            errors.append(
                f"feature {feature_id}: expected domain {expected_domains.get(feature_id)!r}, got {feature.get('domain')!r}"
            )

    domain_scores: Dict[str, List[int]] = defaultdict(list)
    classifications: Counter[str] = Counter()
    bands: Counter[str] = Counter()
    for feature in features:
        if not isinstance(feature, dict) or not isinstance(feature.get("score"), int):
            continue
        domain_scores[feature["domain"]].append(feature["score"])
        classifications[feature["classification"]] += 1
        bands[band(feature["score"])] += 1

    previous_changes: List[Dict[str, Any]] = []
    if args.previous:
        try:
            previous = load_json(args.previous)
            previous_by_id = {item["id"]: item for item in previous.get("features", [])}
            for feature in features:
                old = previous_by_id.get(feature.get("id"))
                if old and old.get("score") != feature.get("score"):
                    previous_changes.append({
                        "id": feature["id"],
                        "feature": feature["feature"],
                        "from": old.get("score"),
                        "to": feature["score"],
                    })
        except (OSError, ValueError, json.JSONDecodeError, KeyError, TypeError) as error:
            errors.append(f"previous catalogue could not be compared: {error}")

    result = {
        "catalogue": str(args.catalog.relative_to(ROOT) if args.catalog.is_relative_to(ROOT) else args.catalog),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "valid": not errors,
        "feature_count": len(features),
        "overall_average": average(feature["score"] for feature in features if isinstance(feature, dict) and isinstance(feature.get("score"), int)),
        "domain_averages": {domain: average(domain_scores[domain]) for domain in DOMAIN_RANGES},
        "classification_counts": dict(sorted(classifications.items())),
        "readiness_bands": dict(sorted(bands.items())),
        "score_changes": previous_changes,
        "errors": errors,
    }

    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
