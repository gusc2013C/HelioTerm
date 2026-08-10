---
name: helioterm
description: "Use by default for every non-interactive terminal operation in software projects: deterministic observations, arbitrary program execution, explicit shell pipelines, long supervision, background jobs, final collection, and cancellation. Compress output locally, avoid model polling, and route only semantically valuable evidence to a temporary Desktop-native Luna session."
---

# HelioTerm

## Temporary Luna leaf guard

If the current input is a `codex_delegation` that identifies this task as the temporary HelioTerm semantic compressor, or directly asks this task to read one `luna_context` ticket and return `{"note":"..."}`, this task is already the Luna leaf. Call `luna_context` exactly once and return only the requested JSON. Never call `create_thread`, `fork_thread`, `list_threads`, `read_thread`, `send_message_to_thread`, `wait_threads`, `handoff_thread`, `set_thread_archived`, or any agent/subagent tool. The parent task alone owns validation, reuse, and archival. This guard takes precedence over the parent lifecycle below and prevents recursive Luna creation.

Resolve `<root>` from this file. Prefer the projected MCP tools because they avoid a terminal command entirely. If the current task predates the latest MCP projection and the local executable is installed, use the short rule path:

`ht -C <project> <operation> <argument...>`

Otherwise the source fallback uses no child model. Invoke once:

`node <root>/scripts/direct-runner.mjs --cwd <project> --request "T|operation|argument"`

Route bounded terminal observations through HelioTerm by default. Combine compatible tests. With projected MCP tools, use `batch` for two to four independent read-only observations that are known up front. In direct mode, repeat `--request` for up to four observations. Each line is at most 256 UTF-8 bytes. A normal compact result ends `model=0`; a large material result may instead return `MORE|...|route=luna|effort=high|ticket=<opaque>|model=0`.

Use `test` for Node (`T|test|tests/*.test.mjs`) and `pytest` for Python (`T|pytest|tests`). The Python mapping disables pytest's cache provider and bytecode writes, so bounded verification does not dirty the project.

Use `files` for one repository-relative directory (`T|files|tests`). Search, files, and read-only Git retain a bounded evidence sample in the single response, so do not rerun the plain command merely to see the first matches or paths.

Use these deterministic inspection operations before falling back to a plain terminal:

- `read`: `T|read|path [start-line] [line-count]` for 1..200 targeted lines.
- `list`: `T|list|directory` for one non-recursive listing with type and byte size.
- `json`: `T|json|path [selector ...]` for top-level shape or selected dotted properties.
- `stat`: `T|stat|path [path ...]` for type, bytes, and modification time.
- `count`: `T|count|path [path ...]` for deterministic line, word, and byte totals.
- `hash`: `T|hash|path [path ...]` for bounded internal SHA-256 checksums.
- `check`: safe quality commands such as `node --check`, `npm test`, `npm run lint`, `py -m pytest`, `ruff check`, `tsc --noEmit`, `cargo check`, `go vet`, or `dotnet test`.
- `deps`: read-only dependency queries such as `npm ls`, `py -m pip check`, `cargo tree`, `go list`, or `dotnet list package`.
- `version`: one supported tool name such as `node`, `npm`, `git`, `rg`, `py`, `ruff`, `cargo`, `go`, or `dotnet`.

Arguments run without a shell. Reject path traversal, mutating package commands, interpreter eval flags, and unsupported command families before execution.

For every command outside the deterministic classes, keep the terminal inside HelioTerm. Prefer the projected `terminal` tool. In a task with the short executable but stale MCP projection, use the shell-free form `ht -C <project> <program> <arguments...>`; use `ht -C <project> exec <program> ...` only when the program name collides with a deterministic operation. The source fallback is:

`node <root>/scripts/terminal-runner.mjs --cwd <project> --program <executable> --arg <argument> [--arg <argument> ...]`

For arbitrary child flags, prefer the collision-free form `--program <executable> -- <child arguments...>`; HelioTerm options must appear before `--`. Add repeated `--env NAME=VALUE` values or one `--stdin`/`--stdin-base64url` payload when required. On Windows, an extensionless `.cmd`/`.bat` shim that rejects direct spawn retries once through a fixed Base64-JSON PowerShell adapter and reports `shim=windows`; user arguments are never concatenated into shell source. Use explicit `--shell powershell|cmd|sh|bash --script <script>` only for pipelines, redirection, or shell built-ins. The universal channel intentionally admits mutations and external access; preserve the owner's approval and destructive-action rules instead of describing it as read-only.

When the HelioTerm MCP tools are projected, prefer `batch` when two to four independent read-only Git/search/files/process/read/list/json/stat/count/hash/deps/version operations are already known, otherwise use `observe` for one. Use `terminal_batch` only when two to four arbitrary short commands are all known up front: it validates the complete list, executes sequentially, and stops on the first failure. It must not replace `terminal_start`/`job_wait` for long work or hide output-dependent planning. Use `run` for one deterministic test, build, check, or benchmark, `terminal` for one other command, `terminal_supervise` for one long arbitrary command, and `terminal_start` for arbitrary background work. These universal tools are truthfully marked destructive and open-world.

Keep compact mode unless exact evidence is necessary. If a result has `more=1` and source, search results, a diff, or failure detail is required for implementation judgment, call `observe` (read-only work) or `run` (tests/builds/checks) once more with `responseMode:"evidence"` and the smallest useful `maxBytes` from 256 through 32768. In direct mode, request the same channel with exactly one request plus `--evidence --evidence-bytes <limit>`. This evidence still runs shell-free through HelioTerm, is recorded by the savings meter, and replaces an ordinary terminal fallback. Do not request evidence for successful tests/builds or when compact facts already answer the question.

Keep process inventory compact. Exact process command lines are intentionally unavailable because they can contain secrets.

For an operation expected to take more than roughly ten seconds, do not start it through an ordinary terminal and repeatedly poll it. If no other owner work can proceed, call `supervise` or `terminal_supervise` once with an explicit deadline. If other work can continue—or the operation may take minutes or hours—call `job_start` or `terminal_start`, retain its opaque handle, continue useful work, and call `job_wait` exactly once at the next natural checkpoint. Call `job_cancel` when the command must stop. A background deadline may be at most 43,200 seconds. State survives Desktop task restarts for seven days; completed arbitrary jobs erase their persisted command, environment, and stdin. Standard MCP cannot push an unsolicited result, so one final collection is required.

Without MCP projection, use `terminal-runner.mjs --background` to start arbitrary work, `--wait-job <handle>` exactly once to collect it, and `--cancel-job <handle>` to stop its process tree. Add `--evidence --evidence-bytes <limit>` to the final wait when exact retained output is required.

Treat `more=1` as an explicit truncation signal. Accept compact facts for discovery, status, successful checks, and test/build outcomes. For source, narrow `read`, then use bounded evidence. Do not use the plain owner terminal for an unsupported mutation or command; route it through universal program or explicit-shell mode. A plain terminal remains only for a genuinely interactive PTY/TUI that requires incremental human keystrokes, or when the user explicitly requires output beyond the bounded evidence channel.

Interpret `OK` as an implicit zero exit and all-operation success; successful batches omit redundant zero/default fields. Require explicit exit and operation-health evidence on `FAIL`.

Token accounting is deterministic. If the MCP transport is already active, call its `savings` tool once at the end of a workload to read process-local exact byte totals and labelled bytes/4 estimates. Do not ask a model to count tokens, and do not treat the estimate as provider billing.

Keep the direct rule compressor for complete counts, status, stat, version, dependency shape, symbol searches, and file facts. Adaptive routing scores semantic value rather than using one coarse threshold: useful failures can route from 512 bytes; real patches and diagnostic build/check evidence can route automatically; successful truncated read/search/log evidence routes only after an explicit semantic request. Add `--semantic` when the user's judgment needs meaning from otherwise ambiguous truncated evidence. Never use Luna merely to count, parse, list, hash, or restate facts. A completed `supervise` or background job follows the same routing rules.

When a result contains `route=luna`, use this Desktop-only lifecycle:

1. If this parent task has no active HelioTerm Luna task, call the Codex Desktop `create_thread` tool with target `{type:"projectless", directoryName:"helioterm-luna-temp"}`, model `gpt-5.6-luna`, and the returned effort (`high` normally, `xhigh` only when requested). The prompt must state that the task is already the Luna leaf, forbid every Codex task/agent lifecycle tool, tell it to call HelioTerm `luna_context` exactly once with the opaque ticket, and then return only `{"note":"..."}`. Do not put raw evidence in the create prompt. If the newly installed MCP tool is not projected until Desktop restarts, allow exactly one fallback call from that Luna task's Desktop integrated terminal: `node "<root>/scripts/luna-ticket-reader.mjs" --ticket <ticket>`. This is a local evidence reader, never Codex CLI. If both access paths fail, Luna must return `{"note":""}` rather than an availability explanation.
2. Wait for the task through `wait_threads`. For later tickets in the same bounded parent workload or user turn, use `send_message_to_thread` on the same task so its initialized context can be cached. Reuse it for at most eight Luna turns, then archive and rotate.
3. Pass Luna's exact JSON text and the ticket to the HelioTerm `luna_accept` MCP tool. Code owns canonical status, counts, byte limits, and acceptance; validation consumes the one-use local ticket whether the note is accepted or falls back to rule-only facts. If the newly installed accept tool is not yet projected, run the source `luna-ticket-acceptor.mjs` locally with the response encoded as base64url; this helper invokes no model. If Luna times out, fails, or returns an invalid response, validate `{}` so the stored rule-only canonical fallback is returned and the ticket is removed.
4. At the end of the parent workload or user turn, and immediately on rejection, timeout, cancellation, tool failure, or the eighth turn, call the Desktop `set_thread_archived` tool. Do not archive between successful tickets when more work in the same bounded burst is already planned. Never leave a temporary Luna task open after the parent workload or user turn ends.

Never start `codex exec`, `codex app-server`, or another Codex CLI process for Luna. Never use an API key for this channel. Desktop coordination does not expose provider token usage, so report only deterministic content-byte metrics returned by `luna_accept`, plus available duration; never infer billing tokens.

Skip preflight in ordinary deterministic mode; the runner validates the full batch before execution. HelioTerm owns command execution and output compression only. The owner retains intent, approvals, editing decisions, review, and judgment.

The older model-backed terminal agent remains an explicit compatibility fallback only. The adaptive channel uses a Desktop projectless task, not `spawn_agent`, CLI, an API call, or the compatibility terminal agent. Spark is not active.
