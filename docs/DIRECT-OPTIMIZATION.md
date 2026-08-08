# Ordinary HelioTerm direct optimization

On 2026-08-08 the ordinary HelioTerm path was changed from a model-backed terminal child to a deterministic direct runner. The runner uses `execFile`, never a shell or MCP transport, batches compatible targets into one request, removes nested Node test context, compresses output before returning it, and reports `model=0`. The configured Spark role remains available only as an explicit semantic fallback. Sol/Luna owner models and reasoning effort are unchanged.

The matched real workload was `node --test tests/pricing.test.mjs tests/profiles.test.mjs` in the Heliolune repository. Every accepted arm passed 23/23 tests.

| Arm | Root tool turns | HelioTerm model tokens | Total tokens | End-to-end | Terminal core |
| --- | ---: | ---: | ---: | ---: | ---: |
| Earlier model-backed Desktop HelioTerm | root + 2 child calls | 70,655 | 172,592 | 26.450 s | 13.513 s child |
| First direct diagnostic, with repeated preflight and one shell retry | 4 | 0 | 105,883 | 27.202 s | 281 ms |
| Optimized `$helioterm` direct path | 2 | 0 | 62,531 | 24.721 s | 271 ms |

The final direct path reduces total tokens by 63.77% and end-to-end time by 6.54% versus the earlier model-backed workflow. The terminal core itself reduces model tokens by 100% and execution latency by 97.99%. Its full Desktop token count is only 1.14% above the matched plain-root terminal arm (61,825), so the remaining cost is the root Sol task and mandatory skill read rather than HelioTerm execution.

Additional real operations used the same direct kernel successfully: a 23-test Heliolune batch completed in 277 ms, a repository search in 37 ms, and read-only `git status --short` in 44 ms. Mutating Git subcommands fail before process execution.

The installed skill no longer repeats preflight for each ordinary request. Preflight remains required for install, upgrade, diagnostics, and model-backed fallback. The default plugin prompt also tells Windows tasks to use the system PowerShell executable, avoiding the inaccessible WindowsApps alias that caused the first extra tool turn.
