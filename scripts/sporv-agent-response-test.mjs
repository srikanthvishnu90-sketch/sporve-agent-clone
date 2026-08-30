import fs from "node:fs";

const path = process.argv[2] || "evals/sporv-product-audit/latest-agent-response.json";
const fail = message => {
  console.error(`agent response contract: FAIL — ${message}`);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};
const exactKeys = (value, expected, label) => {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted), `${label} keys differ: ${actual.join(", ")}`);
};

let response;
try {
  response = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (error) {
  fail(`${path} is not readable JSON: ${error.message}`);
}

const rootKeys = [
  "intent", "release_verdict", "executive_summary", "deterministic_checks",
  "feature_ratings", "regressions", "critical_stop_conditions", "evidence_gaps",
  "score_changes", "top_improvements", "schedule_health", "confidence", "next_action",
];
exactKeys(response, rootKeys, "response");
assert(response.intent === "read", "intent must be read");
assert(["pass", "conditional", "fail"].includes(response.release_verdict), "invalid release verdict");
assert(["high", "medium", "low"].includes(response.confidence), "invalid response confidence");

assert(Array.isArray(response.deterministic_checks), "deterministic_checks must be an array");
for (const [index, check] of response.deterministic_checks.entries()) {
  exactKeys(check, ["name", "status", "evidence"], `deterministic_checks[${index}]`);
  assert(["pass", "fail", "blocked", "not_run"].includes(check.status), `invalid check status at ${index}`);
}

const classifications = new Set([
  "live_verified", "implemented_unverified", "demo_only", "spec_only", "absent", "blocked",
]);
assert(Array.isArray(response.feature_ratings) && response.feature_ratings.length === 87,
  "feature_ratings must contain exactly 87 rows");
for (const [index, rating] of response.feature_ratings.entries()) {
  exactKeys(rating, ["id", "feature", "domain", "classification", "score", "evidence", "blocker", "confidence"],
    `feature_ratings[${index}]`);
  assert(rating.id === index + 1, `feature id ${rating.id} is out of order at index ${index}`);
  assert(classifications.has(rating.classification), `invalid classification for feature ${rating.id}`);
  assert(Number.isInteger(rating.score) && rating.score >= 0 && rating.score <= 10,
    `invalid score for feature ${rating.id}`);
  assert(Array.isArray(rating.evidence), `evidence must be an array for feature ${rating.id}`);
  assert(["high", "medium", "low"].includes(rating.confidence), `invalid confidence for feature ${rating.id}`);
}

for (const key of ["regressions", "critical_stop_conditions", "evidence_gaps", "score_changes"]) {
  assert(Array.isArray(response[key]) && response[key].every(value => typeof value === "string"),
    `${key} must be a string array`);
}
assert(Array.isArray(response.top_improvements) && response.top_improvements.length <= 10,
  "top_improvements must have at most 10 rows");
for (const [index, improvement] of response.top_improvements.entries()) {
  exactKeys(improvement, ["priority", "move", "features", "proof_required"], `top_improvements[${index}]`);
  assert(Number.isInteger(improvement.priority) && improvement.priority >= 1 && improvement.priority <= 10,
    `invalid improvement priority at ${index}`);
  assert(Array.isArray(improvement.features) && improvement.features.every(id => Number.isInteger(id) && id >= 1 && id <= 87),
    `invalid feature references at improvement ${index}`);
}

const average = response.feature_ratings.reduce((total, row) => total + row.score, 0) / 87;
console.log(`agent response contract: PASS — verdict ${response.release_verdict}; 87 ordered ratings; average ${average.toFixed(2)}/10`);
