# Sol terminal-only isolation result

This benchmark freezes Heliolune and does not use a Luna worker. HelioTerm replaces only bounded terminal observations while Sol keeps every task that needs code context, a full diff, editing, review, or judgment. The default HelioTerm path itself uses zero model tokens.

## What was measured

A real Codex Desktop 0.147 Sol/xhigh engineering rollout contained 18 tool calls, including 14 terminal executions. Six terminal executions were safely replaceable: one file discovery, one search, and four test runs. Their real outputs totalled 48,532 bytes. Six conservative 320-byte HelioTerm envelopes total 1,920 bytes, a 96.04% reduction. Across all 139,521 bytes returned by the rollout's terminal executions, this narrow routing alone removes 33.41%.

The six real outputs were then replayed into a fresh Sol/low task and compared with the conservative compact envelopes in another fresh Sol/low task. Both tasks had the same instruction, made no tool calls, produced exactly `ACK`, and were archived after measurement.

| Measurement | Plain terminal | HelioTerm envelope | Change |
| --- | ---: | ---: | ---: |
| Payload bytes | 48,579 | 1,967 | -95.95% |
| Sol input tokens | 33,088 | 20,079 | -13,009 (-39.32%) |
| Sol output tokens | 5 | 5 | unchanged |

This is an exact Codex Desktop input-token measurement of the terminal payload substitution. It is not presented as a full counterfactual rerun of the original 439.7-second engineering task.

## Current repository guardrail

The current self-hosted workload combines the full 30-test suite, Git status, a repository search, and a file listing. It returned 248 compact bytes for 5,288 raw bytes (-95.31%) and completed 20 consecutive batches without a failure after the ordering fix.

Seven alternating local runs measured a 1,227.3 ms median for the four already hand-batched plain commands and 1,267.2 ms for HelioTerm. The wrapper therefore adds 39.8 ms (3.25%) to this local workload. HelioTerm's speed case is fewer owner/tool round trips and concurrent observations; it is not faster than an already hand-batched tiny local command sequence.

## Expanded semantic compression

The request budget is now 256 bytes while every response remains capped at 256 bytes. This admits realistic multi-pattern searches instead of forcing a plain terminal fallback. All eight operation classes now have semantic output: Node tests and pytest expose pass/fail, JSON build and benchmark checks expose pass/failed-check counts, Git exposes status or diff facts, search exposes match counts, file discovery exposes deterministic counts and samples, and process inventory exposes rows without leaking locale-garbled text.

The original expanded real workload used the seven non-pytest classes across eight commands in two batches. It compressed 24,413 raw bytes to 376 bytes (-98.46%) with 35 tests and every check passing. A subsequent stress run completed 10 rounds, 20 batches, and 80 commands without a failure. Three matched latency runs measured 2,204.5 ms for the eight plain commands and 2,213.3 ms for HelioTerm, an 8.8 ms (0.40%) median overhead.

Windows build execution was also repaired: HelioTerm now launches npm's JavaScript CLI through the active Node executable instead of trying to spawn `npm.cmd` with `execFile`, which previously failed with `EINVAL`.

## Real Python projects

Adding a dedicated `pytest` operation exposed a useful speed boundary. On a single test command, the Node wrapper cost 67.6 ms (17.90%) in TactileGear and 58.2 ms (11.52%) in the diagnostic backend. Batching pytest with Git status, a repository search, and test-file discovery amortized that startup cost:

| Project | Tests | Plain bytes | HelioTerm bytes | Reduction | Plain median | HelioTerm median | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TactileGear | 34 | 34,565 | 257 | -99.26% | 479.1 ms | 499.8 ms | +20.8 ms (+4.34%) |
| Diagnostic backend | 12 | 3,234 | 216 | -93.32% | 594.6 ms | 608.7 ms | +14.2 ms (+2.38%) |

Each project used seven alternating runs after warm-up. The table counts the CLI newline; the compact response body itself remains within 256 bytes. Pytest's cache provider and Python bytecode writes were disabled; every run passed and `git status --porcelain=v1` was identical before and after. The benchmark is reproducible with `benchmarks/real-python-batch.mjs`.

## 0.1.0 protocol compression

The release protocol removes successful defaults already implied by `OK`: zero exit status, all-operation success counts, and zero test failures. Failures retain explicit exit and operation-health fields. It also deduplicates normalized evidence lines and replaces the current workspace prefix with `.`, preserving more distinct diagnostics inside the same sample budget.

Seven new alternating runs reduced the TactileGear compact transport from 257 to 223 bytes (-13.23% versus the preceding protocol, -99.35% versus raw) and the diagnostic backend from 216 to 179 bytes (-17.13% versus the preceding protocol, -94.47% versus raw). In a reproducible 104-byte diagnostic corpus, the old first-lines strategy exposed one useful error plus a truncated duplicate; normalization and deduplication exposed three distinct errors in 86 bytes. Run `node benchmarks/semantic-compression.mjs` to reproduce that focused comparison.

## Quality boundary

Search, file listing, read-only Git, and failures keep bounded sanitized evidence. File evidence is sorted before sampling because `rg --files` output order is not stable. Failed operations inspect stderr before successful-looking stdout; failed batches strip ANSI control sequences and prioritize the failed operation's `✖`, assertion, or process error, so a successful prefix cannot hide the real error. Full source reads, full diffs, and implementation output stay with Sol. This preserves owner intelligence while removing terminal text that does not need owner-level reasoning.

The original isolation evidence is in [`benchmarks/results/0.1.0-alpha.1-sol-terminal-isolation.json`](../benchmarks/results/0.1.0-alpha.1-sol-terminal-isolation.json); the consolidated release record is in [`benchmarks/results/0.1.0-release.json`](../benchmarks/results/0.1.0-release.json).
