#!/usr/bin/env python3
"""Deterministic whole-context Headroom benchmark with synthetic messages only."""

from __future__ import annotations

import argparse
import copy
import json
import statistics
import time
from pathlib import Path

import headroom
from headroom import compress


SCHEMA = "HELIOTERM_HEADROOM_CONTEXT_BENCHMARK_V1"
MARKERS = (
    "SYSTEM_POLICY_CONTEXT_SENTINEL",
    "USER_REQUIREMENT_CONTEXT_SENTINEL",
    "FATAL_CONTEXT_JSON_SENTINEL",
    "ERROR_CONTEXT_LOG_SENTINEL",
    "DECISION_CONTEXT_NESTED_SENTINEL",
    "APPROVED_CONTEXT_POLICY_SENTINEL",
    "PROTECTED_CONTEXT_CODE_SENTINEL",
    "PROTECTED_CONTEXT_DIFF_SENTINEL",
)


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def add_tool_turn(messages: list[dict], index: int, name: str, content: str) -> None:
    call_id = f"call_{index}"
    messages.append({
        "role": "assistant",
        "content": None,
        "tool_calls": [{
            "id": call_id,
            "type": "function",
            "function": {"name": name, "arguments": "{}"},
        }],
    })
    messages.append({"role": "tool", "tool_call_id": call_id, "content": content})


def make_context(scale: int) -> list[dict]:
    messages: list[dict] = [
        {
            "role": "system",
            "content": (
                "You are a deterministic engineering reviewer. Preserve exact safety rules, tool-call links, "
                "failures, approved decisions, source signatures, and diffs. "
                "SYSTEM_POLICY_CONTEXT_SENTINEL must remain available."
            ),
        },
        {
            "role": "user",
            "content": (
                "Review the synthetic evidence and identify failures without changing source text. "
                "USER_REQUIREMENT_CONTEXT_SENTINEL must remain available."
            ),
        },
    ]

    json_rows = [
        {
            "id": index,
            "status": "failed" if index == max(1, scale * 2 // 3) else "ok",
            "latency_ms": 90001 if index == max(1, scale * 2 // 3) else 10 + (index % 9),
            "message": "FATAL_CONTEXT_JSON_SENTINEL database unavailable" if index == max(1, scale * 2 // 3)
            else f"request {index} completed " + ("detail " * 12),
        }
        for index in range(scale)
    ]
    add_tool_turn(messages, 1, "database_query", json.dumps({"results": json_rows}, ensure_ascii=False))

    log_lines = []
    for index in range(scale):
        if index == max(1, scale * 3 // 4):
            log_lines.append(f"2026-08-10T12:34:56Z ERROR ERROR_CONTEXT_LOG_SENTINEL timeout_ms=90001 request={index}")
        else:
            log_lines.append(
                f"2026-08-10T12:{index % 60:02d}:00Z INFO request={index} latency_ms={10 + index % 9} "
                f"route=/api/items trace=synthetic-{index:06d}"
            )
    add_tool_turn(messages, 2, "terminal", "\n".join(log_lines))

    nested = {
        "service": "helioterm",
        "policy": {
            "retention": {"days": 7, "marker": "DECISION_CONTEXT_NESTED_SENTINEL"},
            "owners": ["runtime", "desktop"],
        },
        "regions": {
            f"region-{index}": {
                "healthy": True,
                "latency": 10 + index % 5,
                "description": "synthetic nested detail " * 5,
            }
            for index in range(max(20, scale // 2))
        },
    }
    add_tool_turn(messages, 3, "service_inventory", json.dumps(nested, ensure_ascii=False, indent=2))

    prose_lines = [
        (
            "The approved operational decision is APPROVED_CONTEXT_POLICY_SENTINEL: retain seven daily "
            "snapshots and require a scoped rollback review."
            if index == max(1, scale // 3)
            else f"Section {index} explains synthetic service ownership, review sequencing, and deployment expectations. "
                 + ("context " * 12)
        )
        for index in range(max(20, scale // 2))
    ]
    add_tool_turn(messages, 4, "read_document", "\n".join(prose_lines))

    code_lines = [
        f"export function value{index}(input) {{ return input + {index}; }}"
        for index in range(max(40, scale // 4))
    ]
    code_lines.insert(len(code_lines) // 2, "export const PROTECTED_CONTEXT_CODE_SENTINEL = 'preserve-exactly';")
    add_tool_turn(messages, 5, "read_source", "\n".join(code_lines))

    diff_lines = ["diff --git a/src/value.js b/src/value.js", "--- a/src/value.js", "+++ b/src/value.js"]
    for index in range(max(20, scale // 8)):
        diff_lines.extend([f"@@ -{index + 1},1 +{index + 1},1 @@", f"-const value{index} = {index};", f"+const value{index} = {index + 1};"])
    diff_lines.append("+const PROTECTED_CONTEXT_DIFF_SENTINEL = true;")
    add_tool_turn(messages, 6, "git_diff", "\n".join(diff_lines))

    messages.append({"role": "user", "content": "Summarize only the failures and approved decisions from the evidence."})
    return messages


def marker_visibility(messages: list[dict]) -> dict[str, bool]:
    text = encoded(messages).decode("utf-8")
    return {marker: marker in text for marker in MARKERS}


def tool_links_valid(messages: list[dict]) -> bool:
    calls = {
        call.get("id")
        for message in messages
        for call in (message.get("tool_calls") or [])
        if isinstance(call, dict) and call.get("id")
    }
    tool_results = {
        message.get("tool_call_id")
        for message in messages
        if message.get("role") == "tool" and message.get("tool_call_id")
    }
    return bool(calls) and calls == tool_results


def run_context(name: str, scale: int, model_limit: int, rounds: int) -> dict:
    messages = make_context(scale)
    timings = []
    outputs = []
    for _ in range(rounds):
        started = time.perf_counter()
        result = compress(copy.deepcopy(messages), model="gpt-4o", model_limit=model_limit)
        timings.append((time.perf_counter() - started) * 1000)
        outputs.append(result)
    result = outputs[-1]
    optimized = result.messages
    visible = marker_visibility(optimized)
    protected_exact = optimized[:2] == messages[:2]
    after_within_budget = result.tokens_after <= model_limit
    return {
        "name": name,
        "scale": scale,
        "modelLimit": model_limit,
        "rounds": rounds,
        "messageCountBefore": len(messages),
        "messageCountAfter": len(optimized),
        "rawBytes": len(encoded(messages)),
        "optimizedBytes": len(encoded(optimized)),
        "tokensBefore": result.tokens_before,
        "tokensAfter": result.tokens_after,
        "tokensSaved": result.tokens_saved,
        "tokenReductionPercent": round((result.tokens_saved / result.tokens_before) * 100, 3) if result.tokens_before else 0,
        "byteReductionPercent": round((1 - len(encoded(optimized)) / len(encoded(messages))) * 100, 3),
        "firstWallMilliseconds": round(timings[0], 3),
        "warmMedianWallMilliseconds": round(statistics.median(timings[1:] or timings), 3),
        "transforms": sorted({transform for output in outputs for transform in output.transforms_applied}),
        "markerVisibility": visible,
        "visibleMarkers": sum(visible.values()),
        "totalMarkers": len(MARKERS),
        "protectedSystemAndUserExact": protected_exact,
        "toolCallLinksValid": tool_links_valid(optimized),
        "afterWithinModelLimit": after_within_budget,
    }


def incremental_prefix(rounds: int) -> dict:
    base = make_context(400)
    expanded = copy.deepcopy(base)
    expanded.append({"role": "assistant", "content": "The next bounded observation is ready."})
    expanded.append({"role": "user", "content": "Include one additional synthetic observation without rewriting the frozen prefix."})
    add_tool_turn(expanded, 99, "terminal", "\n".join(f"INFO incremental row={index}" for index in range(200)))
    timings = []
    base_result = None
    expanded_result = None
    for _ in range(rounds):
        started = time.perf_counter()
        base_result = compress(copy.deepcopy(base), model="gpt-4o", model_limit=200000)
        expanded_result = compress(copy.deepcopy(expanded), model="gpt-4o", model_limit=200000)
        timings.append((time.perf_counter() - started) * 1000)
    assert base_result is not None and expanded_result is not None
    stable = 0
    for left, right in zip(base_result.messages, expanded_result.messages):
        if encoded(left) != encoded(right):
            break
        stable += 1
    return {
        "baseMessages": len(base_result.messages),
        "expandedMessages": len(expanded_result.messages),
        "stablePrefixMessages": stable,
        "stablePrefixPercent": round((stable / len(base_result.messages)) * 100, 3) if base_result.messages else 100,
        "baseTokensAfter": base_result.tokens_after,
        "expandedTokensAfter": expanded_result.tokens_after,
        "combinedWarmMedianWallMilliseconds": round(statistics.median(timings[1:] or timings), 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--output", default="benchmarks/results/0.4.0-headroom-context.json")
    args = parser.parse_args()
    if not 1 <= args.rounds <= 10:
        raise SystemExit("--rounds must be 1..10")

    scenarios = [
        run_context("small", 120, 200000, args.rounds),
        run_context("medium", 400, 200000, args.rounds),
        run_context("large", 900, 200000, args.rounds),
        run_context("over-120k-budget", 1600, 120000, args.rounds),
    ]
    prefix = incremental_prefix(args.rounds)
    total_before = sum(row["tokensBefore"] for row in scenarios)
    total_after = sum(row["tokensAfter"] for row in scenarios)
    visible = sum(row["visibleMarkers"] for row in scenarios)
    marker_total = sum(row["totalMarkers"] for row in scenarios)
    passed = (
        all(row["tokensAfter"] <= row["tokensBefore"] for row in scenarios)
        and all(row["protectedSystemAndUserExact"] for row in scenarios)
        and all(row["toolCallLinksValid"] for row in scenarios)
        and all(row["afterWithinModelLimit"] for row in scenarios)
        and visible == marker_total
        and prefix["stablePrefixPercent"] == 100
    )
    report = {
        "schema": SCHEMA,
        "pass": passed,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "headroomVersion": getattr(headroom, "__version__", "unknown"),
        "pythonApi": "headroom.compress(messages)",
        "modelForTokenizer": "gpt-4o",
        "externalModelCalls": 0,
        "syntheticContextOnly": True,
        "rawContextRetained": False,
        "accountingNotice": "Headroom tokenizer counts and UTF-8 bytes are controlled benchmark metrics, not Codex Desktop quota or provider billing.",
        "scenarios": scenarios,
        "incrementalPrefix": prefix,
        "aggregate": {
            "tokensBefore": total_before,
            "tokensAfter": total_after,
            "tokensSaved": total_before - total_after,
            "tokenReductionPercent": round((1 - total_after / total_before) * 100, 3),
            "visibleCriticalFacts": visible,
            "totalCriticalFacts": marker_total,
            "criticalFactRetentionPercent": round((visible / marker_total) * 100, 3),
        },
    }
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"pass": passed, "output": str(output), "version": report["headroomVersion"], "scenarios": len(scenarios)}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
