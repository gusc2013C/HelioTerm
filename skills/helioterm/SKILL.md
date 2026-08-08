---
name: helioterm
description: Run an independently usable, fast zero-model terminal for bounded test, build, read-only git, search, benchmark, or process observations; use repeated requests to batch real-project checks, with a model-backed fallback only when explicitly requested.
---

# HelioTerm

Resolve `<root>` from this file. Ordinary mode uses no MCP or child model. Invoke once:

`node <root>/scripts/direct-runner.mjs --cwd <project> --request "T|operation|argument"`

Combine compatible tests. For up to four different observations, repeat `--request` in that call. Each line is at most 64 UTF-8 bytes. Require one compact result ending `model=0`.

Skip preflight in ordinary mode; the runner validates the full batch before execution. Observe only—never edit, plan, review, or judge.

For an explicit model-backed request only: run preflight, require `[agents.helioterm]`, spawn it once with `fork_turns="none"`, and reuse it for at most eight requests from the same parent. The default fallback is Luna/high; Spark is not active. Inspect Native V2 proof and never use a model merely to parse output. Change the binding with `node scripts/configure-model.mjs --model <id> --effort <effort> --write`, reinstall, and start a new task.
