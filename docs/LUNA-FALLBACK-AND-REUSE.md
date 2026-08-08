# Luna fallback and bounded reuse

The active routing policy is:

1. Use the deterministic direct runner for ordinary supported terminal work. It invokes no model (`model=0`).
2. When semantic terminal handling is explicitly required, use one Luna/high `helioterm` role.
3. Reuse that role for at most eight requests from the same parent task. Start a fresh role when the parent task, working directory, model binding, or permission boundary changes.
4. Keep `helioterm_mcp` on Luna/high as an experimental transport. It must fail closed when `helioterm.run` is unavailable.

The official Codex rate card lists GPT-5.6 Sol at 125 / 12.5 / 750 credits per million input / cached-input / output tokens and GPT-5.6 Luna at 5 / 0.5 / 30. Luna is therefore exactly 25 times cheaper for every metered token class in that table. The direct path is still preferable when no model judgment is needed because zero model tokens cost less and start faster than any child session.

Session reuse is an optimization, not an acceptance shortcut. Reuse preserves the stable prefix and can improve cache hits and startup latency, while the request, call, and response limits prevent a terminal conversation from growing without bound. Runtime rollout inspection must still prove the configured model, effort, Native V2 metadata, parent link, leaf behavior, exact command mapping, and truthful call count.
