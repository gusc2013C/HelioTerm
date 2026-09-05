---
name: helioterm
description: "Use for non-interactive terminal work in software projects: observations, commands, tests, builds, background jobs, and output compression. Use the deterministic runner; route to Desktop Luna only on a semantic ticket."
---

# HelioTerm

## Temporary Luna leaf guard

Activate only when input contains both the exact marker `<helioterm_luna_leaf ticket="OPAQUE_HANDLE">` (a 16-character `[A-Za-z0-9_-]` ticket) and an explicit statement that this task is the temporary HelioTerm semantic compressor. Call `luna_context` exactly once and return only `{"note":"..."}`. Never use any task/agent lifecycle tool: creating, inspecting, messaging, waiting, forking, handing off, or archiving. The parent owns validation, reuse, and archival. Ordinary `codex_delegation`, engineering handoffs, and references to Luna remain owner work. Never treat `source_thread_id` as a ticket.

## Execution

`<root>` is two directories above this file. Prefer projected HelioTerm MCP tools. When projection is stale or unavailable, use installed `ht`:

```text
ht -C <project> <operation> <arguments...>
ht -C <project> <program> <arguments...>
ht -C <project> exec <program> <arguments...>
```

Use `exec` only when the program name collides with a deterministic operation. Without `ht`, use the source runner (no child model):

```text
node <root>/scripts/direct-runner.mjs --cwd <project> --request "T|operation|argument"
node <root>/scripts/terminal-runner.mjs --cwd <project> --program <executable> -- <child arguments...>
```

Use `observe` for read-only work, `run` for tests/builds/checks/benchmarks, and `terminal` for other commands. Batch two to four independent observations known up front with MCP `batch`, `ht -C <project> batch "git status --short" "version node"`, or repeated direct `--request`. CLI batches are compact and read-only; request evidence for one item separately. Each request is one line, at most 256 UTF-8 bytes. On `request-invalid`, follow its `reason` and static `hint` to correct the indicated item. `terminal_batch` validates two to four preplanned arbitrary commands, runs sequentially, and stops on failure. Never batch across a dependent decision or approval.

Deterministic arguments run shell-free; traversal, unsupported command families, interpreter evaluation, and mutating package operations are rejected. Operations:

- `test tests/*.test.mjs`, `pytest tests` (pytest disables cache and bytecode writes); `build` script, `bench` path, `check` quality command (e.g. `node --check`, `npm test`, `ruff check`, `tsc --noEmit`, `cargo check`).
- `git` read-only arguments; `search` arguments; `files` one repository-relative directory.
- `read path [start-line] [line-count]`, with line-count 1..200; `list` non-recursive directory; `json path [dotted-selector ...]`.
- `stat`, `count`, `hash` paths for type/bytes/mtime, line/word/byte counts, SHA-256; `deps` read-only dependency query; `version` supported tool name; `process` compact inventory (exact command lines are unavailable).

For unsupported operations, mutations, and external access, stay inside the universal runner. Pipelines/redirection/built-ins use `ht -C <project> shell powershell|cmd|sh|bash <script>`; source equivalent: `terminal-runner.mjs --shell <name> --script <script>`. Source runner options precede `--`; child flags follow it. Use repeated `--env NAME=VALUE` and one `--stdin` or `--stdin-base64url` as needed. Windows shim retry uses a fixed Base64-JSON PowerShell adapter and reports `shim=windows`; never concatenate user arguments into shell source.

Universal tools allow mutations and external access. The owner retains intent, approvals, editing, and judgment. Ordinary terminal access is only for a genuinely interactive PTY/TUI or an explicit request for output beyond bounded evidence. Skip preflight for ordinary use; the runner validates the whole batch before execution.

## Output

Accept compact `model=0` facts when sufficient. Each response is at most 256 UTF-8 bytes. `OK` implies zero exit and all-operation success; require exit and operation-health evidence on `FAIL`. `more=1` signals omitted evidence, not a reason alone to reread successful tests/builds or complete counts/status. Search/files/Git include a bounded sample.

For source, diffs, or failure wording, narrow `read`, then request exact evidence once: MCP `responseMode:"evidence"` with the smallest useful `maxBytes` (256..32768), or `ht -e <bytes> ...`. Source direct mode requires exactly one request plus `--evidence --evidence-bytes <bytes>`. Evidence stays in HelioTerm and its savings meter. Do not use compressed output for byte-faithful source or diagnostics.

MCP `responseMode:"compressed"` handles large retained terminal/JSON/log content before raw text becomes owner-visible. `compression.backend=native` is default. `auto` sends large nested JSON objects to Headroom's stdio MCP, keeps logs/arrays/code/diffs deterministic, and routes ordinary semantic text through opaque Luna tickets. One payload uses one content backend; external failures fall back to native behavior. `compression_retrieve` takes the returned handle and is open-world because it may start Headroom. Configure with `ht config set compression.<name> <value>`.

Adaptive routing can select useful failures from 512 bytes and real patches/build diagnostics automatically. Successful truncated read/search/log evidence needs explicit semantic intent (`--semantic`) to route. Never use Luna to count, parse, list, hash, or restate facts. Handle every `route=luna` through the lifecycle below without exposing raw text first.

## Long commands

Beyond roughly ten seconds, use `supervise` / `terminal_supervise` once with a deadline if no other work can proceed. Otherwise use `job_start`, `terminal_start`, or `terminal_batch_start`, continue useful work, then call `job_wait` exactly once at a natural checkpoint. Cancel with `job_cancel`; never poll from the model. Background deadlines are at most 43,200 seconds; state survives task restarts for seven days. Completed/cancelled arbitrary jobs erase persisted command, environment, and stdin. MCP cannot push completion, so one final collection is required.

Without MCP: `ht ... bg <program> ...` or `batch-bg <base64url-json-command-array>`, then one `ht ... wait <job>` or `ht ... cancel <job>`. Source equivalents: `--background`, `--wait-job`, `--cancel-job`. Final waits support bounded evidence.

## Desktop Luna lifecycle

1. On `route=luna`, create a temporary Desktop task only if none is active for this parent workload: `create_thread`, target `{type:"projectless", directoryName:"helioterm-luna-temp"}`, model `gpt-5.6-luna`, and returned effort (`high`; `xhigh` only when requested). Include the exact leaf marker and ticket, explicitly identify it as the temporary HelioTerm semantic compressor already at the leaf, forbid every task/agent lifecycle tool, require one `luna_context` call and only `{"note":"..."}` output. Never include raw evidence in the prompt.
2. If MCP is not projected, allow exactly one leaf fallback: `node "<root>/scripts/luna-ticket-reader.mjs" --ticket <ticket>`. If both paths fail, return `{"note":""}`. Never launch Codex CLI or use an API key for Luna.
3. Wait via `wait_threads`; send later tickets to the same task with `send_message_to_thread` for at most eight turns. Pass exact JSON to `luna_accept`; without MCP use `luna-ticket-acceptor.mjs` with the response encoded as base64url. Validation owns canonical facts/byte limits and consumes the ticket. On invalid output, timeout, or failure, validate `{}` to consume it and return the rule-only fallback.
4. Archive with `set_thread_archived` at workload/turn end, immediately on rejection/timeout/cancellation/tool failure, or after the eighth turn. Reuse between successful tickets only while more work in the same bounded burst is planned. Never leave a temporary task open afterward.

The older model-backed terminal agent is an explicit compatibility fallback only; adaptive routing never uses `spawn_agent`, Codex CLI, or API calls. Spark is inactive. Desktop coordination exposes no provider token usage: report only deterministic content-byte metrics from `luna_accept` and available duration.

## Accounting and optional migration

If MCP is active, call `savings` once at workload end. Exact bytes and labelled bytes/4 estimates cover tool content, not provider billing. Never ask a model to count tokens.

At one natural checkpoint per user turn, use `rollout_audit` only when the current rollout path is available. Read metadata only; never infer paths by scanning sessions or use a `source_thread_id`. Treat `requested:false` warnings as advisory. On `requested:true`, prepare a compact handoff with objective, repo, completed work, plan, validation, dirty-worktree ownership, and risks, excluding secrets/raw rollout content. Create one successor through Desktop; only after creation succeeds archive the old task when `archiveOldSession:true`. Never create multiple successors for one decision or claim the MCP subprocess performed Desktop lifecycle actions. `ht config show` and `ht config set migration.<name> <value>` manage settings; migration and archival default to false.
