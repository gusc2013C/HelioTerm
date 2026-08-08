---
name: helioterm
description: "Use by default for bounded terminal work in software projects: tests, builds, lint/type checks, read-only Git, search, recursive files, targeted source/config reads, directory/JSON/stat inspection, dependency and version queries, benchmarks, or process observations. Batch up to four commands into one fast rule-first result; adaptively route only large material evidence to a temporary Desktop-native Luna session and archive it after the burst."
---

# HelioTerm

Resolve `<root>` from this file. The ordinary rule path uses no child model. Invoke once:

`node <root>/scripts/direct-runner.mjs --cwd <project> --request "T|operation|argument"`

Route bounded terminal observations through HelioTerm by default. Combine compatible tests. For up to four different observations, repeat `--request` in that call. Each line is at most 256 UTF-8 bytes. A normal compact result ends `model=0`; a large material result may instead return `MORE|...|route=luna|effort=high|ticket=<opaque>|model=0`.

Use `test` for Node (`T|test|tests/*.test.mjs`) and `pytest` for Python (`T|pytest|tests`). The Python mapping disables pytest's cache provider and bytecode writes, so bounded verification does not dirty the project.

Use `files` for one repository-relative directory (`T|files|tests`). Search, files, and read-only Git retain a bounded evidence sample in the single response, so do not rerun the plain command merely to see the first matches or paths.

Use these deterministic inspection operations before falling back to a plain terminal:

- `read`: `T|read|path [start-line] [line-count]` for 1..200 targeted lines.
- `list`: `T|list|directory` for one non-recursive listing with type and byte size.
- `json`: `T|json|path [selector ...]` for top-level shape or selected dotted properties.
- `stat`: `T|stat|path [path ...]` for type, bytes, and modification time.
- `check`: safe quality commands such as `node --check`, `npm test`, `npm run lint`, `py -m pytest`, `ruff check`, `tsc --noEmit`, `cargo check`, `go vet`, or `dotnet test`.
- `deps`: read-only dependency queries such as `npm ls`, `py -m pip check`, `cargo tree`, `go list`, or `dotnet list package`.
- `version`: one supported tool name such as `node`, `npm`, `git`, `rg`, `py`, `ruff`, `cargo`, `go`, or `dotnet`.

Arguments run without a shell. Reject path traversal, mutating package commands, interpreter eval flags, and unsupported command families before execution.

Treat `more=1` as an explicit truncation signal. Accept the compact facts for discovery, status, successful checks, and test/build outcomes. For source, narrow `read` to a smaller line range first. Use a plain owner terminal only when full source, a complete diff, omitted failure detail, or a genuinely unsupported command is necessary for judgment; treat each fallback as coverage evidence to evaluate for a safe HelioTerm operation.

Interpret `OK` as an implicit zero exit and all-operation success; successful batches omit redundant zero/default fields. Require explicit exit and operation-health evidence on `FAIL`.

Token accounting is deterministic. If the MCP transport is already active, call its `savings` tool once at the end of a workload to read process-local exact byte totals and labelled bytes/4 estimates. Do not ask a model to count tokens, and do not treat the estimate as provider billing.

Keep the direct rule compressor for structured successes, status, search, and file facts. Adaptive Luna is enabled only for output of at least 2 KiB when there is a material failure or working-tree change. For a truncated but otherwise non-material observation, add `--semantic` only when the user's request actually needs a semantic summary. Never use Luna merely to count, parse, list, or restate facts.

When a result contains `route=luna`, use this Desktop-only lifecycle:

1. If this parent task has no active HelioTerm Luna task, call the Codex Desktop `create_thread` tool with target `{type:"projectless", directoryName:"helioterm-luna-temp"}`, model `gpt-5.6-luna`, and the returned effort (`high` normally, `xhigh` only when requested). The prompt must tell Luna to call the HelioTerm `luna_context` MCP tool exactly once with the opaque ticket and then return only `{"note":"..."}`. Do not put raw evidence in the create prompt. If the newly installed MCP tool is not projected until Desktop restarts, allow exactly one fallback call from that Luna task's Desktop integrated terminal: `node "<root>/scripts/luna-ticket-reader.mjs" --ticket <ticket>`. This is a local evidence reader, never Codex CLI.
2. Wait for the task through `wait_threads`. For later tickets in the same bounded burst, use `send_message_to_thread` on the same task so its context can be cached. Reuse it for at most eight Luna turns, then archive and rotate.
3. Pass Luna's exact JSON text and the ticket to the HelioTerm `luna_accept` MCP tool. Code owns canonical status, counts, byte limits, and acceptance; validation consumes the one-use local ticket whether the note is accepted or falls back to rule-only facts. If the newly installed accept tool is not yet projected, run the source `luna-ticket-acceptor.mjs` locally with the response encoded as base64url; this helper invokes no model. If Luna times out, fails, or returns an invalid response, validate `{}` so the stored rule-only canonical fallback is returned and the ticket is removed.
4. In every completion path—including success, rejection, timeout, cancellation, tool failure, and the eighth turn—call the Desktop `set_thread_archived` tool. Never leave a temporary Luna task open after the parent workload or user turn ends.

Never start `codex exec`, `codex app-server`, or another Codex CLI process for Luna. Never use an API key for this channel. Desktop coordination does not expose provider token usage, so report only deterministic content-byte metrics returned by `luna_accept`, plus available duration; never infer billing tokens.

Skip preflight in ordinary mode; the runner validates the full batch before execution. Observe only—never edit, plan, review, or judge.

The older model-backed terminal agent remains an explicit compatibility fallback only. The adaptive channel uses a Desktop projectless task, not `spawn_agent`, CLI, an API call, or the compatibility terminal agent. Spark is not active.
