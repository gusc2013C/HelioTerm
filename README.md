# HelioTerm

HelioTerm is a small, independently usable semantic terminal for Codex Desktop. It delegates only bounded terminal observations to one persistent model-bound leaf, compresses noisy output into a short result, and verifies what actually ran from the persisted Native V2 rollout.

HelioTerm is also bundled by default in Heliolune 0.8 alpha.3, but this repository is self-contained for users who only need the terminal component.

## What it guarantees

- One persistent leaf session, never a planner, writer, reviewer, or delegator.
- Deterministic request mapping: `test`, `build`, `git`, `search`, `bench`, and `process` map to one known command form.
- At most 8 requests/session, 4 command calls/request, 64 request bytes, and 256 response bytes.
- Every final line carries truthful `calls=N` evidence.
- Persisted proof checks the exact role, configured model and effort, Native V2 backend, parent, child-spawn count, commands, byte budgets, and evidence.
- The terminal model can be changed to another model available to the user's Codex account. Availability is accepted only after a real Desktop session proves the configured model; the config file alone is not proof.

The direct `helioterm` role is the default. The shell-free `helioterm_mcp` role is experimental: it removes shell-path construction and compresses output before the model sees it, but current Codex tool discovery can cost more tokens than it saves on small commands. It fails closed with `FAIL|calls=0|mcp-unavailable` when the MCP tool is not projected into a session.

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
