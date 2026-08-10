# HelioTerm

HelioTerm is a small, independently usable semantic terminal for Codex Desktop. Its default direct path executes bounded operations through a deterministic compressor, then routes evidence with real semantic value through an opaque local ticket to one temporary Desktop-native Luna session. Complete machine facts remain `model=0`; failures, real patches, and diverse truncated source/search/build evidence can use Luna/high without making Sol poll a terminal.

HelioTerm is also bundled by default in Heliolune 0.8 alpha.3, but this repository is self-contained for users who only need the terminal component.

## What it guarantees

- Zero HelioTerm model tokens for complete structured facts; owner intelligence is unchanged. Adaptive routing uses operation type, failure state, truncation, evidence diversity, patch semantics, and byte size: useful failures may route from 512 bytes, while successful source/search discovery requires an explicit semantic request. Status/stat/count/version output, symbol-index searches, and repeated noise stay deterministic.
- Deterministic savings accounting: exact UTF-8 bytes plus a clearly labelled local bytes/4 token estimate. The meter never calls a model and never presents estimates as provider billing.
- One optional persistent model-backed leaf, never a planner, writer, reviewer, or delegator.
- One temporary Desktop-native Luna semantic task for each routed burst. It uses a projectless `gpt-5.6-luna` task with high effort by default, reserves xhigh for complex causal analysis, reuses at most eight turns, and is archived when the parent burst ends or immediately on failure. The Sol task sees only an opaque ticket before Luna reads the bounded evidence itself.
- Temporary Luna tasks are explicit leaves: they call `luna_context` directly and are forbidden from creating, inspecting, messaging, waiting for, or archiving another task. The parent may reuse one initialized leaf for up to eight successful tickets in the same bounded workload, then archives it.
- Seventeen deterministic operation classes: Node `test`, Python `pytest`, `build`, read-only `git`, `search`, recursive `files`, `bench`, `process`, targeted `read`, non-recursive `list`, `json`, `stat`, internal `count` and SHA-256 `hash`, safe cross-ecosystem `check`, read-only `deps`, and `version`. Python tests disable cache and bytecode writes; repository inspection rejects absolute paths and parent traversal.
- Broad safe command coverage without a shell: quality checks cover Node/npm, Python, Ruff, ESLint, TypeScript, Cargo, Go, .NET, Maven, Gradle, and CMake forms; dependency and version operations admit only known read-only forms. Unknown package scripts, arbitrary Node benchmark helpers, ripgrep preprocessors/config, Git output/external-diff flags, interpreter eval flags, absolute paths, traversal, and repository-relative symlink escapes fail before execution.
- One universal terminal transport for everything outside those deterministic classes. It executes arbitrary programs with structured arguments, environment overrides, and one-shot stdin; explicit PowerShell/cmd/sh/bash mode admits pipelines, redirection, and shell built-ins. The optional `terminal_batch` runs two to four commands known up front sequentially after atomic validation and stops on first failure. Universal tools are marked destructive and open-world instead of weakening the observation firewall.
- Useful bounded evidence: search, file-list, and read-only Git results retain a sanitized sample instead of forcing a second plain terminal call; Luna evidence collapses consecutive duplicate lines while retaining the repeat count and final diagnostics.
- Adaptive disclosure: `more=1` means the semantic facts are valid but the sample is incomplete. When judgment actually needs original source, search results, a diff, or failure detail, `observe`/`run` can use `responseMode=evidence`, or direct mode can add `--evidence`. This explicit bounded path returns at most 32 KiB and records its real token cost instead of bypassing HelioTerm.
- Up to four different observations share one Node startup and one owner tool turn; the MCP `batch` tool exposes this path directly and adjacent read-only observations run concurrently.
- At most 8 requests/session, 4 command calls/request, 256 request bytes, and 256 compact response bytes. Explicit evidence mode accepts exactly one allowlisted request and a 256..32768-byte body limit. Process inventory intentionally stays compact because process command lines can contain secrets.
- Every final line carries truthful `calls=N` evidence.
- Persisted proof checks the exact role, configured model and effort, Native V2 backend, parent, child-spawn count, commands, byte budgets, and evidence.
- The terminal model can be changed to another model available to the user's Codex account. Availability is accepted only after a real Desktop session proves the configured model; the config file alone is not proof.

The rule-first `direct-runner.mjs` path is the default. Its CLI enables adaptive ticket routing; use `--no-adaptive` only for a matched rule-only benchmark. Add `--semantic` when a truncated non-material observation genuinely needs semantic compression. Spark is not used. The older reusable Luna/high terminal role remains a compatibility fallback, not the adaptive path.

The MCP server exposes fourteen tools: read-only `observe` and `batch`; deterministic `run` and `supervise`; universal `terminal`, `terminal_batch`, and `terminal_supervise`; deterministic/universal background starts; shared `job_wait` and `job_cancel`; `savings`; and the two Luna ticket tools. `batch` accepts two to four independent read-only observations with one shared working directory. `terminal_batch` accepts two to four preplanned commands, validates all of them before execution, runs them sequentially, and stops at the first failure. This structured tool surface is the primary Desktop interface. Compact mode is the default; bounded evidence is explicit. Arbitrary execution is truthfully marked destructive and open-world. Completed arbitrary jobs erase their persisted command, environment, and stdin.

For an existing task whose MCP tool projection cannot refresh until a new task starts, install the short local executable once with `npm link`. It removes both the absolute script path and the `T|...` request envelope:

```powershell
ht -C . test tests/*.test.mjs
ht -C . git status --short --branch
ht -C . node --test tests/*.test.mjs
ht -C . -e 8192 node scripts/custom-check.mjs
ht -C . bg node scripts/long-job.mjs
ht -C . wait <job-handle>
```

Known deterministic operation names select the firewall path automatically; any other first word is an arbitrary program. Use `exec` before a program only when its name collides with a deterministic operation, for example `ht -C . exec git add path` or `ht -C . exec git --version`. The lower-level `--` form also works when the calling shell preserves it. Use `ht shell powershell "..."` only for pipelines, redirection, or shell built-ins.

Run the ordinary direct path from this checkout with:

```powershell
node scripts/direct-runner.mjs --request "T|test|tests/firewall.test.mjs tests/mcp-server.test.mjs" --cwd .
```

The result includes `model=0`. Compatible targets should be combined in one request. Different observations can share the same process and tool result by repeating `--request`:

```powershell
node scripts/direct-runner.mjs --cwd . --request "T|test|tests/firewall.test.mjs" --request "T|git|status --short" --request "T|search|-n model=0 README.md"
```

Targeted source/config and toolchain inspection use the same compact path:

```powershell
node scripts/direct-runner.mjs --cwd . --request "T|read|scripts/kernel.mjs 1 40" --request "T|json|package.json name scripts" --request "T|check|node --check scripts/kernel.mjs" --request "T|deps|npm ls --depth=0"
```

Request exact bounded evidence only when the compact sample is insufficient:

```powershell
node scripts/direct-runner.mjs --cwd . --request "T|read|scripts/kernel.mjs 1 120" --evidence --evidence-bytes 16384
```

Run every other non-interactive command through the universal transport, without a shell by default:

```powershell
node scripts/terminal-runner.mjs --cwd . --program node -- --check scripts/kernel.mjs
node scripts/terminal-runner.mjs --cwd . --program python --env MODE=verify -- scripts/custom-maintenance.py
```

Put HelioTerm options before `--`; every token after it belongs to the child program, so child flags can never collide with HelioTerm flags.

On Windows, PATH tools implemented as command shims retry once through a fixed PowerShell adapter only after direct spawn returns `EPERM`, `EINVAL`, or `ENOENT`. The adapter receives program and arguments as Base64 JSON, never interpolates them into shell source, and reports `shim=windows` in compact mode.

Select a shell only when the operation actually needs shell syntax:

```powershell
node scripts/terminal-runner.mjs --cwd . --shell powershell --script "Get-ChildItem scripts | Select-Object -First 5"
```

The direct universal path supports `--stdin`, `--stdin-base64url`, `--evidence`, `--semantic`, and a deadline up to 43,200 seconds. A genuinely interactive PTY/TUI that requires incremental human keystrokes remains outside the one-result compression protocol.

## Long-running commands without model polling

Use MCP `supervise` or `terminal_supervise` when one expected long operation should occupy a single tool call. HelioTerm streams the process output locally, retains at most a 2 MiB diagnostic tail, counts all raw bytes, enforces its own deadline, and returns once with `wait=internal|polls=0`. Other MCP requests such as `ping` remain responsive while it waits.

For work lasting minutes or hours, call `job_start` or `terminal_start` once with a timeout of at most 43,200 seconds. It returns a 16-character handle immediately; Codex can continue other work and call `job_wait` once at a natural checkpoint. Use `job_cancel` to stop the complete process tree. Without MCP projection, use `terminal-runner.mjs --background`, then one `--wait-job <handle>` or `--cancel-job <handle>`. Job state is stored under the operating-system temporary directory for seven days, so another Desktop task can collect it after a restart.

MCP cannot inject an unsolicited tool result into a conversation after `job_start` has already returned. The one later `job_wait` is therefore intentional; it replaces repeated Codex terminal polling with one local wait. `.mcp.json` raises Codex's per-tool timeout to 12 hours plus a small transport margin.

## Install from this checkout

```powershell
codex plugin marketplace add .
codex plugin add helioterm@helioterm
npm link
node scripts/install-project.mjs --project <your-project> --write
```

The project installer is idempotent and refuses to overwrite a conflicting `helioterm` role. It copies the role into the target project's `.codex/agents` directory and registers it in `.codex/config.toml`. After an update that changes MCP tools, fully restart Codex Desktop and then start a new task; a new projectless task inside the same pre-restart App session can retain the old MCP projection. A skill-only or model-binding change needs a new task. Then invoke `$helioterm`.

## Change the model binding

```powershell
node scripts/configure-model.mjs --model gpt-5.6-luna --effort high --write
node scripts/install-project.mjs --project <your-project> --write
npm run preflight
```

Any syntactically valid Codex model id is accepted by the configurator. Codex Desktop remains the authority on whether the signed-in account can create that model/effort combination.

## Development

```powershell
npm test
npm run preflight
```

HelioTerm is MIT licensed.

The direct search and file-list operations require `ripgrep` (`rg`); read-only Git operations require `git`. `npm run preflight` now fails closed when either executable is unavailable. Python is required only for the optional `pytest` operation.

## Verified results

The first real Codex Desktop acceptance reused one terminal for two exact test requests, proved 2 requests/2 calls and zero child spawns, passed 14/14 independent tests, and compressed 1,390 raw bytes to 48 bytes (3.45%). See [the acceptance report](docs/REAL-DESKTOP-ACCEPTANCE.md).

A later matched three-way transport test passed the same 23 tests in every successful arm. Direct HelioTerm used 1.83% more total tokens than a plain Spark terminal; minimal MCP reduced model-visible command output by 98.01% and was 26.18% faster than direct HelioTerm, but used 20.97% more total tokens because deferred MCP discovery added cached tool context. That 0.1-era MCP surface therefore remained opt-in; 0.2.0 uses Desktop's deferred projection plus the short zero-model fallback instead of forcing every schema into every task. See [the three-way comparison](docs/AB3-TRANSPORT-COMPARISON.md).

The optimized ordinary direct path later ran the same real 23-test Heliolune workload in 271 ms with zero HelioTerm model tokens. Its full Desktop task used 62,531 total tokens, 63.77% below the earlier model-backed HelioTerm workflow. See [the direct optimization report](docs/DIRECT-OPTIMIZATION.md).

The next speed pass combined a real 23-test run, Git status, and configuration search into one process. Median wall time fell from 478.5 ms to 363.6 ms (24.01%), owner-facing terminal results fell from three to one, and the skill input shrank 19.52%; all 23 tests still passed and HelioTerm model usage remained zero.

The terminal-only Sol isolation replay deliberately kept code reading, diffs, edits, and judgment on Sol. Six safe observations from a real Sol/xhigh engineering trace shrank from 48,532 bytes to a conservative 1,920-byte HelioTerm envelope (-96.04%). A paired no-tool Sol measurement reduced exact input usage from 33,088 to 20,079 tokens (-13,009, or -39.32%). The current 30-test plus Git/search/files batch reduced 5,288 raw bytes to 248 bytes (-95.31%), although the local wrapper added 39.8 ms (3.25%) versus four already hand-batched commands. See [the terminal-only isolation report](docs/SOL-TERMINAL-ISOLATION.md) for the scope and limits.

The 0.1.0 baseline covered the original eight operation classes across realistic Node test, pytest, build, Git, search, file-list, benchmark, and process checks. Its original seven-class eight-command workload reduced 24,413 raw bytes to 376 bytes (-98.46%); a 10-round stress run completed 80 commands without failure, while the matched three-run median changed from 2,204.5 ms to 2,213.3 ms (+0.40%). The current protocol expands that baseline to fifteen classes with `read`, `list`, `json`, `stat`, `check`, `deps`, and `version`. Responses still cap at 256 bytes; realistic requests may use up to 256 bytes, and `more=1` prevents omitted source or diff content from being mistaken for complete evidence.

Real Python acceptance then ran seven alternating four-operation batches in two unrelated repositories. For the 0.1.0 protocol, TactileGear passed 34 tests and reduced 34,565 output bytes to 223 including the CLI newline (-99.35%); the diagnostic backend passed 12 tests and reduced 3,234 bytes to 179 (-94.47%). Both Git porcelain states were unchanged.

The 0.1.0 protocol also omits success fields already implied by `OK`, removes duplicate diagnostics, and rewrites the current workspace prefix to `.` in bounded evidence. Compared with the preceding compact protocol, those changes reduced the two real Python batch responses by a further 13.23% and 17.13%. A 104-byte diagnostic experiment increased distinct useful errors from one to three while shrinking the sample from 104 to 86 bytes.

Desktop-native Luna acceptance created a real projectless `gpt-5.6-luna` task through Codex Desktop, used no Codex CLI process, and archived the task after three turns. The first turn completed in 5.02 seconds and the fastest reused turn in 1.69 seconds (-66.36%). The final clean-result contract correctly returned an empty note. Desktop task coordination currently exposes duration and output but not provider token usage, so HelioTerm does not claim a Desktop initialization-token reduction it cannot measure. The deterministic compressor preserves canonical status/counts and rejects generic, incomplete, recounted, malformed, or unexpected notes. See [Rule versus Luna compression](docs/RULE-VS-LUNA-COMPRESSION.md).

A 2026-08-08 whole-project terminal replay alternated seven plain and HelioTerm runs in this repository and TactileGear. All 53 Node tests and 34 Python tests passed, both working trees were unchanged, and median terminal output fell from 33,987 bytes to 398 bytes. The deterministic bytes/4 estimate fell from 8,497 to 100 tokens: 8,397 estimated terminal-observation tokens saved, or 98.83%. Median runtime overhead was 2.30% and 2.51%. A Desktop-native Luna/high semantic check found both compact lines usable and the task was archived. Because Desktop does not expose total thread token usage, whole-task savings are reported only as sensitivity scenarios: approximately 19.77%, 34.59%, or 49.41% when terminal observations represent 20%, 35%, or 50% of task input. See [the machine-readable real-project record](benchmarks/results/real-project-token-savings-2026-08-08.json).

The next coverage pass expanded the safe protocol from eight to fifteen operation classes and used the new operations during its own development. Five-run real-project comparisons for `read`/`list`/`json`/`deps` and `read`/`list`/`deps`/`version` reduced 18,118 bytes to 488 bytes: 4,408 estimated terminal-observation tokens saved (97.31%). Parallel observation execution also made median completion 12.38% faster in HelioTerm and 14.98% faster in TactileGear. The final suites passed 61 HelioTerm tests, 34 TactileGear tests, and 188 frozen Heliolune tests. See [the expanded coverage record](benchmarks/results/expanded-command-coverage-2026-08-08.json).

After a Desktop restart, the installed `0.1.0` cache exposed the updated skill plus native `run` and `savings` MCP tools with all fifteen operations. Every operation passed against HelioTerm, TactileGear, or frozen Heliolune. Across 19 cumulative MCP observations, output fell from 31,530 raw bytes to 1,615 bytes and the deterministic meter reported 7,435 net estimated tokens saved after charging for its own report (94.9% by bytes). The acceptance also found that MCP results lacked the direct runner's `model=0` proof. Cachebuster `0.1.0+codex.20260808153635` is now active: real `read`, `process`, and `version` results all end in `model=0`, and an independent UTF-8 calculation matched the meter's 212-byte compact increment exactly. The final MCP-only validation passed 61 tests, preflight, and diff checks; its 13-run meter reported 13,186 net estimated tokens saved at 98.3% byte reduction. See [the Desktop MCP restart record](benchmarks/results/desktop-mcp-restart-2026-08-08.json).

The complete 0.1.0 release evidence is available in [the machine-readable release record](benchmarks/results/0.1.0-release.json).

HelioTerm 0.1.1 adds the adaptive Desktop-native Luna channel, semantic-value routing, fifteen-operation coverage, exact process-local savings metering, duplicate-evidence collapse, one-use ticket cleanup, truthful observation/execution tool boundaries, and no-poll foreground/background supervision. Its current release gate passed 89 local tests, 34 TactileGear tests, and 188 frozen Heliolune tests. A 12-second synthetic acceptance and a real 188-test Heliolune background run proved that foreground Git/search work completed first, exactly one wait collected each result, model polling stayed zero, and working-tree facts stayed unchanged. Four-worker concurrency, deadline exit 124, failed-job Luna routing, and deletion of the launching plugin cache were also exercised. See [the machine-readable 0.1.1 release record](benchmarks/results/0.1.1-release.json).

HelioTerm 0.2.0 makes the structured MCP terminal the primary Desktop entry and adds a globally linked `ht`/`helioterm` fallback for tasks whose tool schema is stale. A 21-run entry benchmark shortened a representative deterministic command from 108 to 45 bytes (-58.33%) while adding 1.20 ms median startup time (1.22%). The release passed 126 source and installed-cache tests, 188 Heliolune tests, and 34 TactileGear tests. A three-run real Heliolune comparison reduced median output from 16,035 to 53 bytes (-99.67%, 3,995 estimated content tokens) with 0.52% median runtime overhead. Real Desktop Luna/high takeover, Luna/xhigh session reuse, deterministic `model=luna` acceptance, one-use ticket cleanup, and archival passed. The installed cache's JSON-RPC `terminal` call also passed with zero model polls; Codex Desktop still requires a full App restart before an already-running App session exposes an updated MCP schema. See [the machine-readable 0.2.0 release record](benchmarks/results/0.2.0-release.json).

HelioTerm 0.3.0 adds read-only and sequential universal MCP batches so operations known up front need one owner/model turn instead of four. Across three real repositories, the 25-round read-only MCP benchmark reduced round trips by 75%, request bytes by 52.18% to 53.54%, response bytes by 49.90% to 57.53%, and median end-to-end time by 42.88% to 43.31%. The sequential terminal batch kept child-command time effectively unchanged while reducing request bytes by 42.00% to 43.00% and response bytes by 65.52%. The source gate passed 133 HelioTerm, 188 Heliolune, and 34 TactileGear tests. Global source, `ht`, and plugin cache replacement also passed, including direct installed-cache JSON-RPC calls to both new tools. These are transport and raw-context results, not provider billing claims; a fresh Desktop task must still confirm projected tool selection. See [the R&D feasibility report](docs/0.3.0-RD-LOG-FEASIBILITY.md), [R&D snapshot](benchmarks/results/0.3.0-rd-batching-2026-08-10.json), and [installed release record](benchmarks/results/0.3.0-release.json).
