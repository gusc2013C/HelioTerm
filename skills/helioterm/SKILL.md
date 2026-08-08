---
name: helioterm
description: Run one independently usable, model-bound semantic terminal session with deterministic commands, strict request/response/tool budgets, compact noisy-output compression, and persisted Native V2 proof. Use for bounded test, build, git, search, benchmark, or process observations that do not require source reasoning or edits.
---

# HelioTerm

1. Resolve this skill's plugin root from the loaded `SKILL.md` path. Run its `scripts/preflight.mjs --compact` by absolute path and require a pass.
2. Require the current project to have `[agents.helioterm]`. If it is missing, explain that setup mutates `.codex/config.toml` and ask the user to run `<plugin-root>/scripts/install-project.mjs --project <project> --write`, then start a new task.
3. Read `model-binding.json`; spawn its `agentType` with `fork_turns="none"` and no model or effort override.
4. Send exactly one `T|operation|argument` line, at most 64 UTF-8 bytes. Reuse the same child with `followup_task`; never replace a failed session. Use at most eight requests.
5. Require a final line at most 256 bytes with truthful `calls=N`. The child is a leaf semantic terminal and cannot edit, plan, review, reason about source, or delegate.
6. Locate the rollout by canonical agent path, configured role, and parent. Run the plugin root's `scripts/inspect-proof.mjs` with the configured role/model/effort and require all checks to pass.

Change the model with `node scripts/configure-model.mjs --model <codex-model-id> --effort <effort> --write`, reinstall or refresh the plugin, and start a new task. Runtime rollout metadata, not the written id, proves the model.
