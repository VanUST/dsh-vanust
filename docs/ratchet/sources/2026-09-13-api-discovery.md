# API discovery session

The harness API was measured rather than recalled, because the design rests on four
capabilities that would each invalidate a module if assumed wrongly.

Measured: a tool body sees the session workspace at
`exec.agent.session.header.cwd`; `defineTool` compiles an author schema into the
enforced JSON-Schema subset while a definition registered directly is validated as
RAW JSON Schema; a value violating a declared `output.schema` is rejected; and the
subagent runtime registers as `subagents` (plural) and can spawn a child agent whose
structured verdict is read back.

The plural spelling cost a false finding: probing the singular produced "the dynamic
layer is impossible", which was wrong by one character. Two durable lessons came out
of it — a service name that was never registered looks exactly like a capability
that is missing, and a check that cannot fail is not a check.

The discovery also established that the plugin tree fails to boot when a plugin
declares an injection the composition does not satisfy, which is why the ratchet
reaches the subagents runtime opportunistically instead.
