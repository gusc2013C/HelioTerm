# HelioTerm

HelioTerm is a small, independently usable semantic terminal for Codex Desktop. Its default direct path executes bounded operations without MCP or a child model and returns one compact line. A configurable model-backed leaf remains available as an explicit fallback and can be verified from persisted Native V2 rollout metadata.

HelioTerm is also bundled by default in Heliolune 0.8 alpha.3, but this repository is self-contained for users who only need the terminal component.

## What it guarantees

- Zero HelioTerm model tokens on the default direct path; owner intelligence is unchanged.
- One optional persistent model-backed leaf, never a planner, writer, reviewer, or delegator.
- Deterministic request mapping: Node `test`, Python `pytest`, `build`, read-only `git`, `search`, `files`, `bench`, and `process` map to known command forms. `pytest` disables its cache provider and bytecode writes; `files` maps one repository-relative directory to `rg --files <directory>`.
- Useful bounded evidence: search, file-list, and read-only Git results retain a sanitized sample instead of forcing a second plain terminal call.
- Adaptive disclosure: `more=1` means the semantic facts are valid but the sample is incomplete. Sol can request the original source or full diff only when judgment actually needs it.
- Up to four different observations share one Node startup and one owner tool turn; adjacent read-only observations run concurrently.
- At most 8 requests/session, 4 command calls/request, 256 request bytes, and 256 response bytes. The larger request budget admits real multi-pattern repository searches while the model-visible result remains fixed.
- Every final line carries truthful `calls=N` evidence.
- Persisted proof checks the exact role, configured model and effort, Native V2 backend, parent, child-spawn count, commands, byte budgets, and evidence.
- The terminal model can be changed to another model available to the user's Codex account. Availability is accepted only after a real Desktop session proves the configured model; the config file alone is not proof.

The zero-model `direct-runner.mjs` path is the default. The reusable Luna/high `helioterm` role is the optional model-backed fallback; Spark is not used by the active default or fallback. The shell-free `helioterm_mcp` role is experimental: it removes shell-path construction and compresses output before the model sees it, but current Codex tool discovery can cost more tokens than it saves on small commands. It fails closed with `FAIL|calls=0|mcp-unavailable` when the MCP tool is not projected into a session. See [Luna fallback and bounded reuse](docs/LUNA-FALLBACK-AND-REUSE.md) for the routing and session-lifetime policy.

Run the ordinary direct path from this checkout with:

```powershell
node scripts/direct-runner.mjs --request "T|test|tests/firewall.test.mjs tests/mcp-server.test.mjs" --cwd .
```

The result includes `model=0`. Compatible targets should be combined in one request. Different observations can share the same process and tool result by repeating `--request`:

```powershell
node scripts/direct-runner.mjs --cwd . --request "T|test|tests/firewall.test.mjs" --request "T|git|status --short" --request "T|search|-n model=0 README.md"
```

## Install from this checkout

```powershell
codex plugin marketplace add .
codex plugin add helioterm@helioterm
node scripts/install-project.mjs --project <your-project> --write
```

The project installer is idempotent and refuses to overwrite a conflicting `helioterm` role. It copies the role into the target project's `.codex/agents` directory and registers it in `.codex/config.toml`. Start a new Codex task after installation or a model change, then invoke `$helioterm`.

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

A later matched three-way transport test passed the same 23 tests in every successful arm. Direct HelioTerm used 1.83% more total tokens than a plain Spark terminal; minimal MCP reduced model-visible command output by 98.01% and was 26.18% faster than direct HelioTerm, but used 20.97% more total tokens because deferred MCP discovery added cached tool context. MCP therefore remains opt-in. See [the three-way comparison](docs/AB3-TRANSPORT-COMPARISON.md).

The optimized ordinary direct path later ran the same real 23-test Heliolune workload in 271 ms with zero HelioTerm model tokens. Its full Desktop task used 62,531 total tokens, 63.77% below the earlier model-backed HelioTerm workflow. See [the direct optimization report](docs/DIRECT-OPTIMIZATION.md).

The next speed pass combined a real 23-test run, Git status, and configuration search into one process. Median wall time fell from 478.5 ms to 363.6 ms (24.01%), owner-facing terminal results fell from three to one, and the skill input shrank 19.52%; all 23 tests still passed and HelioTerm model usage remained zero.

The terminal-only Sol isolation replay deliberately kept code reading, diffs, edits, and judgment on Sol. Six safe observations from a real Sol/xhigh engineering trace shrank from 48,532 bytes to a conservative 1,920-byte HelioTerm envelope (-96.04%). A paired no-tool Sol measurement reduced exact input usage from 33,088 to 20,079 tokens (-13,009, or -39.32%). The current 30-test plus Git/search/files batch reduced 5,288 raw bytes to 248 bytes (-95.31%), although the local wrapper added 39.8 ms (3.25%) versus four already hand-batched commands. See [the terminal-only isolation report](docs/SOL-TERMINAL-ISOLATION.md) for the scope and limits.

Expanded semantic compression now covers all eight operation classes across realistic Node test, pytest, build, Git, search, file-list, benchmark, and process checks. The original seven-class eight-command workload reduced 24,413 raw bytes to 376 bytes (-98.46%); a 10-round stress run completed 80 commands without failure, while the matched three-run median changed from 2,204.5 ms to 2,213.3 ms (+0.40%). Responses still cap at 256 bytes; realistic requests may use up to 256 bytes, and `more=1` prevents omitted source or diff content from being mistaken for complete evidence.

Real Python acceptance then ran seven alternating four-operation batches in two unrelated repositories. For the 0.1.0 protocol, TactileGear passed 34 tests and reduced 34,565 output bytes to 223 including the CLI newline (-99.35%); the diagnostic backend passed 12 tests and reduced 3,234 bytes to 179 (-94.47%). Both Git porcelain states were unchanged.

The 0.1.0 protocol also omits success fields already implied by `OK`, removes duplicate diagnostics, and rewrites the current workspace prefix to `.` in bounded evidence. Compared with the preceding compact protocol, those changes reduced the two real Python batch responses by a further 13.23% and 17.13%. A 104-byte diagnostic experiment increased distinct useful errors from one to three while shrinking the sample from 104 to 86 bytes.

The complete 0.1.0 release evidence is available in [the machine-readable release record](benchmarks/results/0.1.0-release.json).
