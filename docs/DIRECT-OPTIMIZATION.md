# Ordinary HelioTerm direct optimization

On 2026-08-08 the ordinary HelioTerm path was changed from a model-backed terminal child to a deterministic direct runner. The runner uses `execFile`, never a shell or MCP transport, batches compatible targets into one request, removes nested Node test context, compresses output before returning it, and reports `model=0`. The explicit semantic fallback now uses Luna/high; Spark is not an active binding. Sol/Luna owner models and reasoning effort are unchanged.

The matched real workload was `node --test tests/pricing.test.mjs tests/profiles.test.mjs` in the Heliolune repository. Every accepted arm passed 23/23 tests.

| Arm | Root tool turns | HelioTerm model tokens | Total tokens | End-to-end | Terminal core |
| --- | ---: | ---: | ---: | ---: | ---: |
| Earlier model-backed Desktop HelioTerm | root + 2 child calls | 70,655 | 172,592 | 26.450 s | 13.513 s child |
| First direct diagnostic, with repeated preflight and one shell retry | 4 | 0 | 105,883 | 27.202 s | 281 ms |
| Optimized `$helioterm` direct path | 2 | 0 | 62,531 | 24.721 s | 271 ms |

The final direct path reduces total tokens by 63.77% and end-to-end time by 6.54% versus the earlier model-backed workflow. The terminal core itself reduces model tokens by 100% and execution latency by 97.99%. Its full Desktop token count is only 1.14% above the matched plain-root terminal arm (61,825), so the remaining cost is the root Sol task and mandatory skill read rather than HelioTerm execution.

Additional real operations used the same direct kernel successfully: a 23-test Heliolune batch completed in 277 ms, a repository search in 37 ms, and read-only `git status --short` in 44 ms. Mutating Git subcommands fail before process execution.

The installed skill no longer repeats preflight for each ordinary request. Preflight remains required for install, upgrade, diagnostics, and model-backed fallback. The default plugin prompt also tells Windows tasks to use the system PowerShell executable, avoiding the inaccessible WindowsApps alias that caused the first extra tool turn.

## Speed and token round 2

The direct kernel was separated from the MCP transport, and the CLI now accepts up to four repeated `--request` values in one process. Compatible tests still share one `node --test` command. Adjacent read-only Git, search, and process observations run concurrently; test, build, and benchmark operations remain ordered barriers. The entire batch is parsed and command-mapped before any process starts, so one invalid or mutating operation fails with `calls=0`.

A five-run real-project workload combined the same 23-test batch, `git status --short`, and a configuration search. Three separate direct-runner processes had a 478.5 ms median and 486.5 ms p95. One batched process had a 363.6 ms median and 368.4 ms p95, improving latency by 24.01% and 24.28% respectively while retaining 23/23 tests, zero operation failures, and `model=0`. The single 23-test guardrail remained effectively unchanged at 325.7 ms before versus 324.2 ms after.

The owner-facing result turns for that workload fall from three to one. The loaded skill shrank from 1,409 to 1,134 UTF-8 bytes (19.52%) and from 193 to 154 whitespace-delimited words (20.21%). These are directly measured token-input surfaces; no unmeasured Desktop total-token claim is inferred from them. HelioTerm model usage remains exactly zero.
