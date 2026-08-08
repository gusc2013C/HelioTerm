# HelioTerm

HelioTerm is a small, independently usable semantic terminal for Codex Desktop. Its default direct path executes bounded operations without MCP or a child model and returns one compact line. A configurable model-backed leaf remains available as an explicit fallback and can be verified from persisted Native V2 rollout metadata.

HelioTerm is also bundled by default in Heliolune 0.8 alpha.3, but this repository is self-contained for users who only need the terminal component.

## What it guarantees

- Zero HelioTerm model tokens on the default direct path; owner intelligence is unchanged.
- One optional persistent model-backed leaf, never a planner, writer, reviewer, or delegator.
- Deterministic request mapping: `test`, `build`, `git`, `search`, `bench`, and `process` map to one known command form.
- At most 8 requests/session, 4 command calls/request, 64 request bytes, and 256 response bytes.
- Every final line carries truthful `calls=N` evidence.
- Persisted proof checks the exact role, configured model and effort, Native V2 backend, parent, child-spawn count, commands, byte budgets, and evidence.
- The terminal model can be changed to another model available to the user's Codex account. Availability is accepted only after a real Desktop session proves the configured model; the config file alone is not proof.

The zero-model `direct-runner.mjs` path is the default. The `helioterm` role is the optional model-backed fallback. The shell-free `helioterm_mcp` role is experimental: it removes shell-path construction and compresses output before the model sees it, but current Codex tool discovery can cost more tokens than it saves on small commands. It fails closed with `FAIL|calls=0|mcp-unavailable` when the MCP tool is not projected into a session.

Run the ordinary direct path from this checkout with:

```powershell
node scripts/direct-runner.mjs --request "T|test|tests/firewall.test.mjs tests/mcp-server.test.mjs" --cwd .
```

The result includes `model=0`. Compatible targets should be batched into one request so one process and one tool result cover the workload.

## Install from this checkout

```powershell
codex plugin marketplace add .
codex plugin add helioterm@helioterm
node scripts/install-project.mjs --project <your-project> --write
```

The project installer is idempotent and refuses to overwrite a conflicting `helioterm` role. It copies the role into the target project's `.codex/agents` directory and registers it in `.codex/config.toml`. Start a new Codex task after installation or a model change, then invoke `$helioterm`.

## Change the model binding

```powershell
node scripts/configure-model.mjs --model gpt-5.3-codex-spark --effort medium --write
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

## Verified alpha result

The first real Codex Desktop acceptance reused one terminal for two exact test requests, proved 2 requests/2 calls and zero child spawns, passed 14/14 independent tests, and compressed 1,390 raw bytes to 48 bytes (3.45%). See [the acceptance report](docs/REAL-DESKTOP-ACCEPTANCE.md).

A later matched three-way transport test passed the same 23 tests in every successful arm. Direct HelioTerm used 1.83% more total tokens than a plain Spark terminal; minimal MCP reduced model-visible command output by 98.01% and was 26.18% faster than direct HelioTerm, but used 20.97% more total tokens because deferred MCP discovery added cached tool context. MCP therefore remains opt-in. See [the three-way comparison](docs/AB3-TRANSPORT-COMPARISON.md).

The optimized ordinary direct path later ran the same real 23-test Heliolune workload in 271 ms with zero HelioTerm model tokens. Its full Desktop task used 62,531 total tokens, 63.77% below the earlier model-backed HelioTerm workflow. See [the direct optimization report](docs/DIRECT-OPTIMIZATION.md).
