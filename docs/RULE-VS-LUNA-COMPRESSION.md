# Rule versus Luna compression

## Decision

HelioTerm separates accounting from compression:

- Accounting is deterministic and model-free. Exact UTF-8 bytes are authoritative; `ceil(bytes / 4)` is a clearly labelled local estimate, not a billing claim.
- Rules own canonical status, counts, exits, and routing.
- Luna may add a semantic note only for material failures, changes, or truncated evidence.

Ordinary structured output stays on the zero-model rule path. Luna is not used to count tokens or re-derive facts.

## Desktop-only Luna transport

HelioTerm uses Codex Desktop task tools for Luna. It does not launch `codex exec`, `codex app-server`, or any other Codex CLI process.

When the user explicitly requests Luna semantic compression:

1. Create one projectless Desktop task with model `gpt-5.6-luna` and high effort. Use xhigh for complex failure chains, cross-module causality, or risk synthesis.
2. Send a minimal stable contract plus canonical facts and bounded evidence.
3. Wait for completion through Desktop task coordination.
4. Reuse the same task for a related burst of at most eight requests.
5. Archive the task through Desktop when the burst completes or fails.

Projectless execution is deliberate: Luna receives the evidence directly and does not need repository access. The prompt tells it not to use tools.

## Native Desktop acceptance

The 2026-08-08 acceptance created a real projectless Luna task, reused it twice, and archived it. No Codex CLI process was started.

| Turn | Contract | Duration | Result |
| --- | --- | ---: | --- |
| First | Summarize material changed areas | 5.02 s | Valid semantic note |
| Reused | Same task, related evidence | 1.69 s | Valid JSON; exposed a clean-result contract gap |
| Reused | Clean evidence must return empty note | 3.67 s | `{"note":""}` |
| Reused high | Summarize concrete fixes | 7.59 s | Valid, concrete semantic note |
| Reused xhigh | Synthesize underlying engineering risk | 2.27 s | Valid causal-risk note |

The fastest comparable low-effort reused response was 66.36% faster than the first response. This percentage is calculated and tested from recorded durations, not by a model. High and xhigh used different prompts on an already warm thread, so their observed durations are acceptance evidence, not a controlled speed ranking.

Desktop task coordination currently returns duration and output but does not expose provider `tokenUsage`. Therefore HelioTerm makes no claim about exact Desktop initialization-token reduction. It can honestly optimize and report prompt bytes, task reuse, latency, output correctness, and archival state. Machine-readable evidence is in `benchmarks/results/desktop-luna-native-2026-08-08.json`.

## Quality firewall

Code owns the canonical line. Desktop Luna returns only JSON shaped as `{"note":"..."}`. The deterministic validator rejects:

- invalid JSON or extra fields;
- missing or unexpected notes;
- generic notes that merely state a change/test occurred;
- notes that repeat canonical numbers;
- multiline, pipe-containing, incomplete, or over-budget notes.

Rejected output falls back to the canonical rule result. A clean result must return an empty note.

## Routing policy

The default policy requires all of the following:

1. At least 2,048 raw output bytes.
2. A material failure, working-tree change, or explicit truncation.
3. A semantic explanation that would prevent a larger raw-output handoff.
4. An explicit user request authorizing a Desktop Luna task.

Successful tests/builds, clean Git status, counts, timings, and ordinary search/file facts remain deterministic and model-free.

## Real-project terminal replay

The 2026-08-08 replay used ordinary engineering observations, not synthetic strings. It alternated plain-command-first and HelioTerm-first ordering for seven measured runs after warmup in two repositories:

- HelioTerm: 53 Node tests, compact preflight, Git status, and a repository-wide Luna/token/Desktop search.
- TactileGear: 34 Python tests, Git status, test-file discovery, and exception/TODO search across source and tests.

Both test suites passed and both Git porcelain states were identical before and after the benchmark. Median output totals were 33,987 raw bytes and 398 HelioTerm bytes. The local `utf8-bytes-ceil-div4-v1` estimate is 8,497 versus 100 tokens, a reduction of 8,397 estimated terminal-observation tokens (98.83%). Median runtime overhead was 2.30% in HelioTerm and 2.51% in TactileGear.

A reused Desktop-native `gpt-5.6-luna` task at high effort accepted both compact lines as retaining status, scope, output size, timing, and follow-up signals. It used no CLI process and was archived immediately after the check. Luna did not calculate any token figure.

Desktop exposes no provider token counter for the whole task, so this replay does not turn the 98.83% terminal figure into a false total-task measurement. As a transparent sensitivity calculation, a terminal-observation share of 20%, 35%, or 50% implies approximately 19.77%, 34.59%, or 49.41% total-task savings. Prompts, source edits, reasoning, and hidden system context are outside this measurement. Full evidence is in `benchmarks/results/real-project-token-savings-2026-08-08.json`.
