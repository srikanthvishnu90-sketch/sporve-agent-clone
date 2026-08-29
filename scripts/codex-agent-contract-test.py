#!/usr/bin/env python3
"""Static contract test for the project-scoped Codex analytical council."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / ".codex" / "config.toml"
AGENT_DIR = ROOT / ".codex" / "agents"
GATES = ROOT / "GATES.md"

SPECIALISTS = {
    "intent_clarifier",
    "requirements_analyst",
    "evidence_verifier",
    "repository_mapper",
    "product_strategist",
    "ux_accessibility_reviewer",
    "frontend_architect",
    "backend_api_architect",
    "supabase_rls_analyst",
    "stripe_payments_risk_analyst",
    "security_privacy_coppa_reviewer",
    "reliability_observability_reviewer",
    "performance_cost_analyst",
    "sporv_test_agent",
    "adversarial_critic",
}
LEAD = "sporv_analytical_lead"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def section(source: str, name: str) -> str:
    match = re.search(
        rf"(?ms)^\[{re.escape(name)}\]\s*$\n(.*?)(?=^\[|\Z)",
        source,
    )
    require(match is not None, f"missing [{name}] section")
    return match.group(1)


def string_value(source: str, key: str) -> str:
    match = re.search(rf'(?m)^{re.escape(key)}\s*=\s*"([^"]+)"\s*$', source)
    require(match is not None, f"missing string key: {key}")
    return match.group(1)


def instructions_value(source: str) -> str:
    match = re.search(r'(?ms)^developer_instructions\s*=\s*"""(.*?)"""\s*$', source)
    require(match is not None, "missing developer_instructions")
    return match.group(1)


config_source = CONFIG.read_text(encoding="utf-8")
gates_source = GATES.read_text(encoding="utf-8")
require(
    "Four gates. Nothing else counts as progress." in gates_source,
    "GATES.md must remain the sole progress definition",
)
gate_matches = re.findall(
    r"(?m)^## (G[1-4]) — [^\n]+\n\n\*\*Status: (TRUE|FALSE)\.\*\*",
    gates_source,
)
require(
    [gate_id for gate_id, _status in gate_matches] == ["G1", "G2", "G3", "G4"],
    "GATES.md must contain exactly G1–G4 in order with explicit TRUE/FALSE statuses",
)
require(gates_source.count("**Done looks like:**") == 4, "every gate needs one Done looks like clause")
require("Do not add a new AI tool until G4" in gates_source, "G4 must gate any new AI tool")
require(
    re.search(r"(?m)^allow_login_shell\s*=\s*false\s*$", config_source) is not None,
    "login shells must remain disabled",
)
features = section(config_source, "features")
require(re.search(r"(?m)^shell_tool\s*=\s*false\s*$", features) is not None, "shell tool must remain disabled")
agents_config = section(config_source, "agents")
require(re.search(r"(?m)^enabled\s*=\s*true\s*$", agents_config) is not None, "multi-agent support must be enabled")
thread_match = re.search(r"(?m)^max_concurrent_threads_per_session\s*=\s*(\d+)\s*$", agents_config)
require(thread_match is not None, "missing subagent thread ceiling")
thread_cap = int(thread_match.group(1))
require(1 <= thread_cap <= 3, "subagents must run in bounded waves of at most three")

profiles = {}
for path in sorted(AGENT_DIR.glob("*.toml")):
    source = path.read_text(encoding="utf-8")
    name = string_value(source, "name")
    require(name not in profiles, f"duplicate agent name: {name}")
    string_value(source, "description")
    string_value(source, "model")
    string_value(source, "model_reasoning_effort")
    require(string_value(source, "sandbox_mode") == "read-only", f"{path.name}: must be read-only")
    instructions = instructions_value(source)
    for required in ("GATES.md", "G1–G4", "NOTHING MOVED", "Done looks like", "new AI tool"):
        require(required in instructions, f"{path.name}: gate contract omits {required}")
    profiles[name] = {"developer_instructions": instructions}

expected = SPECIALISTS | {LEAD}
require(expected == profiles.keys(), f"agent profile mismatch: expected {sorted(expected)}, got {sorted(profiles)}")
require(len(SPECIALISTS) == 15, "council must contain exactly fifteen specialists")

lead_instructions = profiles[LEAD]["developer_instructions"]
for specialist in SPECIALISTS:
    require(specialist in lead_instructions, f"lead routing omits {specialist}")
require("AGENTS.md" in lead_instructions, "lead must inherit the shared questioning contract")
require("read | proposed | clarify | refuse" in lead_instructions, "lead must preserve the chatbox envelope")

test_instructions = profiles["sporv_test_agent"]["developer_instructions"]
for required in (
    "live_verified",
    "implemented_unverified",
    "demo_only",
    "spec_only",
    "release_verdict=pass|conditional|fail",
    "Never edit files",
    "autonomous improvement is forbidden",
):
    require(required in test_instructions, f"test agent contract omits: {required}")

repository_contracts = {
    ROOT / "AGENTS.md": ("GATES.md", "NOTHING MOVED", "Do not propose or add a new AI tool"),
    ROOT / "CLAUDE.md": ("GATES.md", "NOTHING MOVED", "no new AI"),
    ROOT / "evals" / "sporv-product-audit" / "test-agent-prompt.md": ("GATES.md", "NOTHING MOVED"),
    ROOT / "docs" / "codex-scheduled-quality-task.md": ("GATES.md", "NOTHING MOVED"),
    ROOT / ".github" / "workflows" / "scheduled-quality-audit.yml": ("gates-status.py", "not progress"),
}
for path, required_values in repository_contracts.items():
    source = path.read_text(encoding="utf-8")
    for required in required_values:
        require(required in source, f"{path.relative_to(ROOT)} omits gate contract: {required}")

print("Codex council contract: G1–G4-only progress rubric; 1 lead + 15 read-only specialists; login/legacy shell disabled")
