# Real Codex Desktop acceptance

HelioTerm 0.1.0-alpha.1 passed a fail-closed Codex Desktop probe on 2026-08-08.

The root created one persistent terminal child and reused it for two requests. Persisted rollout inspection proved the expected model (`gpt-5.3-codex-spark`), medium effort, Codex Desktop origin, Native V2 metadata, parent link, identity marker, zero child spawns, and exact deterministic command mapping. Both requests used one tool call and truthfully returned `calls=1`.

The child completed in 16.9 seconds. It compressed 1,390 bytes of raw test output to 48 response bytes (3.45%). Independent root verification passed 14/14 tests and `git diff --check`. No proof check failed and no repository file changed.

The machine-readable record is [0.1.0-alpha.1-real-desktop.json](../benchmarks/results/0.1.0-alpha.1-real-desktop.json).

This result proves the default bound model and protocol on one real Desktop workflow. It does not claim that every Codex account exposes every model id; alternate bindings must be proven by a new real rollout after configuration.
