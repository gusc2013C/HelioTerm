---
name: helioterm
description: "Use by default for bounded and long-running terminal work in software projects: batch ordinary observations, supervise one long command without model polling, or persist a background job while Codex continues. Route semantically valuable failures, patches, and diverse truncated evidence to a temporary Desktop-native Luna session and archive it after the burst."
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

When the HelioTerm MCP tools are projected, prefer `observe` for read-only Git/search/files/process/read/list/json/stat/deps/version work. Use `run` for short tests, builds, checks, or benchmarks that execute project code. Their annotations intentionally differ so Codex can auto-approve observations without misrepresenting execution as read-only.

For an operation expected to take more than roughly ten seconds, do not start it through an ordinary terminal and repeatedly poll it. If no other owner work can proceed, call `supervise` once with an explicit deadline; HelioTerm streams and compresses output locally and returns `polls=0`. If other work can continue—or the operation may take minutes or hours—call `job_start`, retain its opaque handle, continue useful work, and call `job_wait` exactly once at the next natural checkpoint or when nothing else remains. A background deadline may be at most 43,200 seconds. State survives Desktop task restarts for seven days. Standard MCP cannot push an unsolicited result after `job_start`, so one later `job_wait` is required; never replace it with repeated status calls.

Treat `more=1` as an explicit truncation signal. Accept the compact facts for discovery, status, successful checks, and test/build outcomes. For source, narrow `read` to a smaller line range first. Use a plain owner terminal only when full source, a complete diff, omitted failure detail, or a genuinely unsupported command is necessary for judgment; treat each fallback as coverage evidence to evaluate for a safe HelioTerm operation.

Interpret `OK` as an implicit zero exit and all-operation success; successful batches omit redundant zero/default fields. Require explicit exit and operation-health evidence on `FAIL`.

Token accounting is deterministic. If the MCP transport is already active, call its `savings` tool once at the end of a workload to read process-local exact byte totals and labelled bytes/4 estimates. Do not ask a model to count tokens, and do not treat the estimate as provider billing.

Keep the direct rule compressor for complete counts, status, stat, version, dependency shape, and file facts. Adaptive routing scores semantic value rather than using one coarse threshold: useful failures can route from 512 bytes; real patches and diverse truncated read/search/build/check evidence can route from 768 bytes; status-only changes, diff statistics, repeated noise, and complete machine facts stay rule-only. Add `--semantic` when the user's judgment needs meaning from otherwise ambiguous truncated evidence. Never use Luna merely to count, parse, list, or restate facts. A completed `supervise` or background job follows the same routing rules.

When a result contains `route=luna`, use this Desktop-only lifecycle:

1. If this parent task has no active HelioTerm Luna task, call the Codex Desktop `create_thread` tool with target `{type:"projectless", directoryName:"helioterm-luna-temp"}`, model `gpt-5.6-luna`, and the returned effort (`high` normally, `xhigh` only when requested). The prompt must tell Luna to call the HelioTerm `luna_context` MCP tool exactly once with the opaque ticket and then return only `{"note":"..."}`. Do not put raw evidence in the create prompt. If the newly installed MCP tool is not projected until Desktop restarts, allow exactly one fallback call from that Luna task's Desktop integrated terminal: `node "<root>/scripts/luna-ticket-reader.mjs" --ticket <ticket>`. This is a local evidence reader, never Codex CLI.
2. Wait for the task through `wait_threads`. For later tickets in the same bounded burst, use `send_message_to_thread` on the same task so its context can be cached. Reuse it for at most eight Luna turns, then archive and rotate.
3. Pass Luna's exact JSON text and the ticket to the HelioTerm `luna_accept` MCP tool. Code owns canonical status, counts, byte limits, and acceptance; validation consumes the one-use local ticket whether the note is accepted or falls back to rule-only facts. If the newly installed accept tool is not yet projected, run the source `luna-ticket-acceptor.mjs` locally with the response encoded as base64url; this helper invokes no model. If Luna times out, fails, or returns an invalid response, validate `{}` so the stored rule-only canonical fallback is returned and the ticket is removed.
4. In every completion path—including success, rejection, timeout, cancellation, tool failure, and the eighth turn—call the Desktop `set_thread_archived` tool. Never leave a temporary Luna task open after the parent workload or user turn ends.

Never start `codex exec`, `codex app-server`, or another Codex CLI process for Luna. Never use an API key for this channel. Desktop coordination does not expose provider token usage, so report only deterministic content-byte metrics returned by `luna_accept`, plus available duration; never infer billing tokens.

Skip preflight in ordinary mode; the runner validates the full batch before execution. Observe only—never edit, plan, review, or judge.

The older model-backed terminal agent remains an explicit compatibility fallback only. The adaptive channel uses a Desktop projectless task, not `spawn_agent`, CLI, an API call, or the compatibility terminal agent. Spark is not active.
