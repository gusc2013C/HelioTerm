# Three-way terminal transport comparison

On 2026-08-08 HelioTerm ran a matched three-way test against the same Heliolune checkout. Every controlled arm used `gpt-5.3-codex-spark`, medium effort, one execution call, and the exact workload `node --test tests/pricing.test.mjs tests/profiles.test.mjs`. All successful arms passed 23/23 tests.

| Arm | Transport | Input | Cached input | Uncached input | Output | Total | Wall time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | plain terminal | 30,945 | 19,200 | 11,745 | 405 | 31,350 | 16.287 s |
| B | direct HelioTerm | 31,189 | 18,944 | 12,245 | 736 | 31,925 | 22.884 s |
| C | minimal-config MCP HelioTerm | 37,311 | 27,904 | 9,407 | 1,308 | 38,619 | 16.893 s |

Direct HelioTerm versus the plain terminal changed total tokens by +1.83% and wall time by +40.51%. It compressed what the parent receives, but the Spark leaf still consumed the raw command output.

MCP compressed 2,060 raw output bytes to a 41-byte result, a 98.01% reduction before the model boundary. Versus direct HelioTerm it reduced uncached input by 23.18% and wall time by 26.18%, but increased total tokens by 20.97%. The extra cost came from deferred MCP tool discovery and cached tool context, not from command output. A non-minimal MCP session used 52,325 total tokens, confirming that unrelated enabled tool context makes the problem worse.

The real Desktop orchestration arm reached the same quality for A and B, but the fixed subagent boundary dominated the small workload: plain root execution used 61,825 total tokens and 12.057 seconds; root plus direct HelioTerm used 172,592 total tokens and 26.450 seconds (+179.16% tokens, +119.37% time). Desktop V2 did not project the local `helioterm.run` MCP tool into the custom child. The child attempted a forbidden shell fallback and failed both tests. The role now fails closed instead, and MCP remains experimental.

Conclusion: keep HelioTerm installed and independently usable, keep the direct role as the default, and select it only when reuse or noisy output can amortize its fixed session cost. Do not claim token savings for MCP on small tasks. The machine-readable evidence is in `benchmarks/results/0.1.0-alpha.1-ab3.json`.
