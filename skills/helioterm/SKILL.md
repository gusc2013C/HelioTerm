---
name: helioterm
description: Run an independently usable, fast zero-model terminal for bounded Node or pytest tests, build, read-only git, search, file-list, benchmark, or process observations; use repeated requests to batch real-project checks, with a model-backed fallback only when explicitly requested.
---

# HelioTerm

Resolve `<root>` from this file. Ordinary mode uses no MCP or child model. Invoke once:

`node <root>/scripts/direct-runner.mjs --cwd <project> --request "T|operation|argument"`

Combine compatible tests. For up to four different observations, repeat `--request` in that call. Each line is at most 256 UTF-8 bytes. Require one compact result ending `model=0`.

Use `test` for Node (`T|test|tests/*.test.mjs`) and `pytest` for Python (`T|pytest|tests`). The Python mapping disables pytest's cache provider and bytecode writes, so bounded verification does not dirty the project.

Use `files` for one repository-relative directory (`T|files|tests`). Search, files, and read-only Git retain a bounded evidence sample in the single response, so do not rerun the plain command merely to see the first matches or paths.

Treat `more=1` as an explicit truncation signal. Accept the compact facts for discovery, status, successful checks, and test/build outcomes. Use a plain owner terminal only when full source, a complete diff, or omitted failure detail is necessary for judgment.

Interpret `OK` as an implicit zero exit and all-operation success; successful batches omit redundant zero/default fields. Require explicit exit and operation-health evidence on `FAIL`.

Skip preflight in ordinary mode; the runner validates the full batch before execution. Observe only—never edit, plan, review, or judge.

For an explicit model-backed request only: run preflight, require `[agents.helioterm]`, spawn it once with `fork_turns="none"`, and reuse it for at most eight requests from the same parent. The default fallback is Luna/high; Spark is not active. Inspect Native V2 proof and never use a model merely to parse output. Change the binding with `node scripts/configure-model.mjs --model <id> --effort <effort> --write`, reinstall, and start a new task.
