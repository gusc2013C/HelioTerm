# Changelog

## 0.4.1 - 2026-08-18

### Installation hardening

- Add an explicit bootstrap command that previews writes, supports an isolated `CODEX_HOME` for CI, installs the project role, and runs preflight.
- Make ordinary plugin use independent of `npm link`; global `ht` linking remains an optional checkout convenience.
- Pin the direct Git marketplace example to `v0.4.1` and smoke-test source installation in an isolated CI project.
- Produce a versioned release ZIP plus SHA256 and validate preflight and bootstrap from the extracted archive before publication.

## 0.4.0 - 2026-08-17

- Add Headroom-inspired deterministic importance routing for terminal, JSON/JSONL, and log evidence, preserving failures, numeric outliers, change points, and boundaries while protecting code and diffs from semantic rewriting.
- Add opt-in MCP `responseMode=compressed` and one `compression_retrieve` interface with TTL-bound opaque handles; keep existing compact and exact evidence APIs unchanged.
- Add an internal stdio MCP adapter for Headroom's `headroom_compress`, `headroom_retrieve`, and optional `headroom_stats` tools. Real Headroom 0.34.0 benchmarks narrow `auto` to large nested JSON objects, keep stronger deterministic routes local, route ordinary semantic text through the existing opaque Desktop Luna channel, avoid model-visible intermediary calls, and fail open to native compression.
- Add `ht config` settings for backend choice, minimum size, Headroom launch command/arguments/deadline, and local retrieval TTL. Native mode remains the default and starts no external service.
- Credit the Headroom Contributors and distinguish exact bytes, content estimates, sampling-boundary savings, and provider billing.
- Add a no-LLM whole-context Headroom benchmark covering 14.8K–191.5K-token synthetic conversations, critical-fact retention, exact protected messages, tool-call integrity, 120K budget compliance, and incremental prefix stability without retaining context bodies.

## 0.3.1 - 2026-08-10

- Add `terminal_batch_start` plus the source/short-runner `batch-bg` path for atomically validated two-to-four-command background workflows with one opaque handle, sequential stop-on-failure execution, one final wait, cancellation, seven-day state recovery, bounded per-step evidence, and sensitive payload cleanup.
- Add deterministic owner-wakeup and model-sampling-boundary proxies to batch results and the savings meter; bytes/4 remains explicitly a tool-content estimate, never Desktop quota or provider billing.
- Expand rollout auditing with per-task/per-date token, sampling, wrapper, output-byte, and compaction summaries plus advisory 40-samples/user and 120K-context thresholds without AI, prompt retention, or automatic task lifecycle actions.
- Add the read-only `rollout_audit` MCP decision tool and `ht config` settings for opt-in Desktop owner migration and separately opt-in old-task archival. The MCP child remains unable to invoke lifecycle APIs; automatic handoff is performed by the owner workflow only after a positive deterministic decision.
- Require an explicit `<helioterm_luna_leaf ticket="...">` marker and temporary-compressor identity before the Luna leaf guard activates; ordinary `codex_delegation` handoffs and `source_thread_id` values remain owner work.

## 0.3.0 - 2026-08-10

- Add a read-only MCP `batch` tool that exposes the existing four-operation parallel runner and collapses known independent observations into one owner/model round trip.
- Add a sequential `terminal_batch` for two to four arbitrary commands known up front, with whole-batch validation and mandatory stop on first failure; do not parallelize mutations or absorb dependent planning.
- Add a privacy-preserving rollout metrics parser that counts token deltas, cache ratio, sampling frequency, wrapper fan-out, and tool-output bytes without retaining prompt, command, or output content.
- Add matched real MCP client/server benchmarks across three repositories; keep provider billing and Codex quota estimates explicitly out of scope.

## 0.2.0 - 2026-08-10

- Register the structured MCP server as the primary Desktop terminal interface while retaining a short `ht`/`helioterm` executable for existing tasks whose MCP projection is fixed until a new task starts.
- Add concise deterministic, arbitrary-program, explicit-shell, background start, one-shot wait, cancellation, evidence, stdin, environment, timeout, and semantic-routing syntax without the absolute runner path or `T|...` envelope.
- Add a universal shell-free terminal transport with bounded evidence, Windows command-shim hardening, truthful destructive/open-world annotations, and adaptive Luna routing for material command results.
- Let arbitrary background work persist across Desktop restarts, retain bounded evidence, erase command/environment/stdin payloads after completion or cancellation, and stop the complete process tree on cancellation.
- Validate real Desktop-native Luna/high takeover and same-task Luna/xhigh reuse through one-use tickets, deterministic `model=luna` acceptance, and mandatory archival.

## 0.1.1 - 2026-08-09

- Add `supervise` plus persistent `job_start`/`job_wait` MCP paths so minute- and hour-scale commands can run without model polling while other Codex work continues; retain only a bounded log tail and persist final state across Desktop task restarts.
- Replace the coarse 2 KiB Luna threshold with semantic-value routing for failures, real patches, and diverse truncated evidence while keeping complete facts and repeated noise on the deterministic path.
- Split truthful read-only `observe` metadata from execution tools and harden package scripts, benchmark entry points, ripgrep options/config/path containment, Git external/output flags, and symlink escapes.
- Static-import the deterministic observer so replacing an installed plugin cache cannot strand a running MCP process on a deleted helper path.
- Add an explicit temporary-Luna leaf guard so the compressor cannot recurse into `create_thread`/`wait_threads`; reuse one initialized Luna only within a bounded parent burst and reserve xhigh for genuinely complex multi-failure or large causal analysis.
- Stress four concurrent background workers, deadline exit 124, cross-process failed-job Luna routing, whole-cache deletion during execution, and a real 188-test Heliolune background run while foreground Git/search observations continue.
- Fail closed on Luna transport/meta notes such as `luna_context unavailable`, and document that MCP schema updates require a full Desktop restart because a new projectless task alone can retain the pre-update tool projection.
- Expand the deterministic terminal from eight to fifteen operation classes with targeted source/config inspection, safe quality checks, dependency queries, and version checks.
- Add exact content-byte savings metering and labelled bytes/4 estimates without asking a model to count tokens.
- Add an adaptive Desktop-native Luna/high or xhigh channel for large material failures and changes, with opaque bounded tickets, reusable temporary tasks, deterministic acceptance, and mandatory task archival.
- Collapse consecutive duplicate Luna evidence while preserving repeat counts and final diagnostics, and consume each local ticket after acceptance or rule-only fallback.
- Prevent pathless ripgrep searches from waiting on stdin, treat a no-match exit as a successful zero-match observation, and map bounded process name/PID queries correctly on Windows.
- Keep matched real-project benchmarks on the rule-only path so working-tree changes cannot trigger Luna or invalidate deterministic comparisons.
- Validate 89 HelioTerm tests, 34 TactileGear tests, and 188 frozen Heliolune tests, plus preflight, diff, installed MCP, intelligent Luna-route probes, synthetic and real-project no-poll background acceptance.

## 0.1.0 - 2026-08-08

- Make the zero-model direct runner the default bounded terminal path.
- Batch up to four observations and run adjacent read-only observations concurrently.
- Add semantic compression for Node tests, pytest, builds, read-only Git, search, file lists, benchmarks, and process inventory.
- Add bounded evidence, adaptive `more=1` disclosure, duplicate diagnostic removal, workspace-path normalization, and successful-default elision.
- Disable pytest cache and bytecode writes to keep observed projects unchanged.
- Prioritize stderr and failed-operation evidence so successful prefixes cannot hide errors.
- Keep the Luna/high model-backed role and MCP transport explicit, optional fallbacks.
- Validate against HelioTerm itself and two unrelated Python repositories, including 46 passing real-project tests.
- Validate required Git and ripgrep executables during preflight and exercise Windows and Ubuntu CI without duplicate branch/PR runs.
