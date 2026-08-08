---
name: helioterm
description: Run an independently usable zero-model direct semantic terminal for bounded test, build, git, search, benchmark, or process observations, with compact output and an optional configurable model-backed fallback when explicitly requested.
---

# HelioTerm

Resolve the plugin root from this file. Combine compatible targets into one `T|operation|argument` line of at most 64 UTF-8 bytes; one `node --test` call should receive all fitting test files.

For the ordinary path call `node <plugin-root>/scripts/direct-runner.mjs --request <line> --cwd <project-root>` exactly once. Require one compact result ending `model=0`. Do not run preflight on every request: the direct runner validates and fails closed, while preflight belongs to install, upgrade, and diagnostics.

Only when the user explicitly requests a model-backed terminal, run preflight, require `[agents.helioterm]`, spawn the configured role with `fork_turns="none"`, batch the request, and inspect its persisted Native V2 proof. Never use a model merely to parse exit codes or test counts. HelioTerm does not edit, plan, review, or make engineering judgments.

Change the optional fallback model with `node scripts/configure-model.mjs --model <codex-model-id> --effort <effort> --write`, reinstall or refresh the plugin, and start a new task. Runtime rollout metadata, not the written id, proves a model-backed run.
