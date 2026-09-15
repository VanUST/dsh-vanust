/**
 * Ratchet tool surface: the ratchet's operations, declared as harness tools.
 *
 * This file is an adapter and nothing else. It resolves the project root from the
 * session workspace, declares the model-facing schemas, shapes responses, and owns
 * the two harness connections — the subagent runtime a judge is spawned on, and the
 * user-questions channel a ratification is put to a human through. Every decision
 * about what a project's laws are, whether the code obeys them, whether a human
 * consented, and what a report says lives in `ratchet-schema.mjs`,
 * `ratchet-compiler.mjs`, `ratchet-verifier.mjs`, `ratchet-state.mjs`,
 * `ratchet-ratify.mjs` and `ratchet-ops.mjs`, none of which import the harness.
 *
 * That split is not tidiness. It is what lets the gate be run by a shell and by a
 * test through the SAME code path the model calls, so "the gate fails when it
 * should" is a fact about the gate rather than a claim about a tool declaration.
 * The test suite exercises the operations directly and needs no harness, no
 * credentials and no model.
 *
 * Two harness facts constrain the declarations, both measured rather than assumed
 * (see `docs/RATCHET-API-FACTS.md`):
 *
 *   - Every tool is declared with `defineTool`. A definition registered directly
 *     against `ctx.tools.register()` is validated as RAW JSON Schema, so a
 *     zero-argument tool whose parameter root lacks a `type` makes the provider
 *     reject the entire request with `Invalid schema for function …`.
 *   - `inject: ['tools']` is the whole dependency. Nothing here reaches the
 *     subagent runtime, the user-questions channel or any optional service through
 *     injection, so a deployment that mounts only the base bundle can still compile
 *     and verify.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolve } from 'node:path'
import { MANIFEST_PATH, PROBLEM_CODES } from './ratchet-schema.mjs'
import { REVIEW_JOBS } from './ratchet-dynamic.mjs'
import { registerGuard } from './ratchet-guard.mjs'
import {
  bootstrap,
  compile,
  findRoot,
  ingest,
  ratifications,
  ratify,
  ratifyInteractively,
  review,
  status,
  submitReview,
  summariseProblems,
  verify,
} from './ratchet-ops.mjs'

/** Cordis function-plugin name; also the id a profile patch row targets. */
export const name = 'ratchet'

/**
 * Services requested before `apply` runs.
 *
 * `tools` only, deliberately. Cordis makes an injection a hard gate in both
 * directions (measured; see `docs/RATCHET-API-FACTS.md` §3.3): declaring a name no
 * service registers leaves the entry pending and fails the whole boot, while
 * reading `ctx.<name>` without declaring it throws. The static layer must keep
 * working in a base-only composition, so the subagents runtime is reached
 * opportunistically through `ctx.get('subagents')` at call time — and its absence
 * is the degraded path rather than a boot failure.
 */
export const inject = ['tools']

/**
 * The service name the subagent runtime registers under.
 *
 * **Plural.** The row id is `subagent` and the package's prose says `subagents`
 * while the constructor calls `super(ctx, "subagents")`. Asking for the singular
 * returns `undefined` and produced a completely false "the runtime is
 * unreachable" finding during API discovery, so the name lives in one constant
 * with this note attached rather than being spelled at each call site.
 */
export const SUBAGENTS_SERVICE = 'subagents'

/**
 * The service name the human-question channel registers under.
 *
 * Camel-case and plural, exactly as the service registers it (`super(ctx,
 * "userQuestions")`). Like the subagent runtime it is reached through
 * `ctx.get(name)` at call time rather than through `inject`, because declaring a
 * service an installation does not mount fails the whole boot — and a project
 * without a question channel can still compile, verify and report.
 */
export const USER_QUESTIONS_SERVICE = 'userQuestions'

/**
 * The service name the live agent registry registers under.
 *
 * Read for one fact only: whether the calling agent is a runtime ROOT. The
 * auto-review a compile triggers asks it before spawning a judge, so a judge that
 * itself compiles cannot start a review of its own (see `isRootCaller`).
 */
export const AGENTS_SERVICE = 'agents'

/**
 * The service name the slash-command registry registers under.
 *
 * Read for one capability: registering `/ratify`, the same operation as the
 * `ratchet_ratify` tool, reached without the model. A command handler runs host-side
 * and receives `invocation.agent`, so it can put the ratchet's own question to the
 * human directly — which a browser half cannot, because the question seam is
 * Agent-scoped. Reached through `ctx.get` at apply time rather than through `inject`,
 * for the same reason as the other optional services: a composition that mounts no
 * command registry must still compile and verify. `@deepseek-ai/dsh-base` mounts it,
 * so it is present in every profile this deployment ships.
 */
export const COMMANDS_SERVICE = 'commands'

export { PROBLEM_CODES }

/**
 * Resolves the project root for one tool call.
 *
 * The workspace comes from the session the call belongs to, never from the server's
 * launch directory: the harness is normally started from a home or app directory, so
 * searching upward from `process.cwd()` finds no manifest.
 *
 * @param exec - Tool-execution context supplied by the harness.
 * @returns `{ root, found }` where `root` is the session workspace even when no
 *   manifest was found above it — `ratchet_bootstrap` needs to know where to write,
 *   and a workspace is a better answer than nothing. `found` distinguishes the two
 *   cases for the operations that genuinely require a manifest.
 */
export function rootFor(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) return { root: null, found: false }
  const found = findRoot(cwd)
  return { root: found ?? cwd, found: found !== null }
}

/**
 * Registers the four ratchet tools.
 *
 * @param ctx - Cordis context; must expose `tools` (declared in `inject`).
 * @returns Nothing. Registrations are made inside `ctx.effect`, the disposal
 *   contract that lets a hot reload replace them instead of colliding with the
 *   registry's duplicate-name rule.
 */
export function apply(ctx) {
  // The guard is registered OUTSIDE the tool-registration effect, and on its own
  // effect: it is a different extension point (`tools.guard`), governs calls to
  // other plugins' tools, and must survive a failure to register any single tool.
  registerGuard(ctx, (exec) => rootFor(exec).root)

  ctx.effect(() => {
    const disposers = []

    /** Registers one tool, reporting a failure instead of taking the tree down. */
    const register = (definition) => {
      try {
        disposers.push(ctx.tools.register(definition))
      } catch (error) {
        process.stderr.write(`ratchet: cannot register ${definition.name}: ${String(error)}\n`)
      }
    }

    /**
     * The canonical output declaration.
     *
     * `{ type: 'json' }` is the DSL's unconstrained lossless-JSON node. It is
     * available here only because these are `defineTool` definitions; a raw
     * registered schema is validated as JSON Schema and rejects it.
     */
    const output = () => ({
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    })

    /**
     * Runs one operation that requires an existing project.
     *
     * Async because verification is: a law may declare a `command` check, and awaiting
     * here is what lets the tool return the result rather than a promise. The runner
     * is deliberately NOT supplied — a tool an agent calls mid-edit must not spawn
     * processes the user did not ask for, so a command check surfaces as
     * `checksPending` and the answer says so.
     */
    const withRoot = async (exec, operation, explicitRoot = null) => {
      // An explicit `root` wins over the session workspace. Measured on a real task: an
      // agent working in another project called `ratchet_status`, which resolved the
      // SESSION workspace — the kit — and answered with the kit's state
      // (`VERIFY_NOT_RUN`) for a project that was verified and green. Every tool answers
      // about a project, so the caller must be able to say which one; the resolved root
      // is in every result either way.
      const { root, found } =
        typeof explicitRoot === 'string' && explicitRoot.length > 0
          ? { root: resolve(explicitRoot), found: true }
          : rootFor(exec)
      if (root === null || !found) {
        const problems = [
          {
            code: 'MANIFEST_MISSING',
            severity: 'error',
            subject: null,
            message:
              root === null
                ? `this session has no workspace directory, so there is nowhere to look for ${MANIFEST_PATH}`
                : `no ${MANIFEST_PATH} found in ${root} or any parent, so this project declares no decisions`,
          },
        ]
        return {
          ok: false,
          stage: 'resolve-root',
          reason: problems[0].message,
          fix: 'call ratchet_bootstrap in preview mode to see the manifest and directories it would create, then apply it',
          problems,
          summary: summariseProblems(problems),
        }
      }
      return operation(root)
    }

    /**
     * Puts one quiz to the human through the harness user-questions channel.
     *
     * Reached opportunistically, like the subagent runtime: a deployment with no
     * question channel is a deployment where ratification cannot happen, which is a
     * fact to report rather than a boot to fail. Every failure mode is returned as a
     * value — no service, no agent to route through, a service with no `ask`, a
     * thrown ask (the seam refuses a caller that is not the live root agent, which
     * is exactly the case of a subagent trying to obtain consent for its parent's
     * decision, and that refusal must not be mistaken for consent).
     *
     * `null` means "this call has no channel", which the operation turns into a
     * prepared quiz and an actionable next step rather than an exception.
     *
     * @param exec - Tool-execution context, for the agent and the abort signal.
     * @returns An `askHuman` for the ratification operation, or `null`.
     */
    const humanChannel = (exec) => {
      const service = ctx.get(USER_QUESTIONS_SERVICE)
      const agent = exec?.agent
      if (service === undefined || service === null || typeof service.ask !== 'function' || agent === undefined) {
        return null
      }
      return async (quiz) => {
        try {
          const answer = await service.ask({
            agent,
            questions: quiz.questions,
            ...(exec?.signal === undefined ? {} : { signal: exec.signal }),
          })
          return { kind: 'ok', answer }
        } catch (error) {
          return { kind: 'unavailable', reason: String(error) }
        }
      }
    }

    /**
     * Runs `/ratify [<adr-id> …]` for the session that invoked it.
     *
     * The same operation as the `ratchet_ratify` tool, and deliberately the same code
     * path: it builds the quiz with `ratifyInteractively`, asks it through the single
     * question channel `humanChannel` reaches, and returns the canonical result. The
     * only thing a command adds is that it is reached without a model turn, because a
     * command handler is host-side and already holds the session's agent.
     *
     * A handler that throws is a handler whose failure the registry reports as
     * `kind: 'error'`; this one catches its own failures so the message names what
     * happened rather than the exception's shape.
     *
     * @param invocation - The command invocation: `agent`, `rawInput`, `signal`.
     * @returns A `CommandResult` — `success` when a decision was ratified or the
     *   human declined deliberately, `error` when there was nothing to ask, the
     *   channel was unreachable, or the answer could not be read. A command that
     *   cannot put its question never reports success.
     */
    const ratifyFromCommand = async (invocation) => {
      const exec = { agent: invocation?.agent, signal: invocation?.signal }
      const { root, found } = rootFor(exec)
      if (root === null || !found) {
        return {
          kind: 'error',
          text:
            root === null
              ? 'the /ratify command has no session workspace, so there is no project to ratify in'
              : `no ${MANIFEST_PATH} was found above the session workspace, so this project declares no decisions to ratify`,
        }
      }

      try {
        const result = await ratifyInteractively({
          root,
          ids: parseRatifyIds(invocation?.rawInput),
          askedBy: askedByFor(exec),
          askHuman: humanChannel(exec),
        })
        return { kind: ratifyOutcomeKind(result), text: renderRatifyOutcome(result) }
      } catch (error) {
        return {
          kind: 'error',
          text: `the ratification did not settle: ${String(error)}. Nothing was written for a call that threw, so no consent was minted.`,
        }
      }
    }

    /**
     * Puts a freshly ingested decision to the human in the same call, when asked.
     *
     * This is the grill entry: the agent grills the human, writes the reasoning to a
     * source, and asks the ratchet to record the decision — and the human consents in
     * the same flow, through the one question channel. It is a third ENTRY, never a
     * third channel: the quiz is the ratchet's own and no argument accepts an answer.
     * It is also the ONE entry whose question is rendered in the Conversation rather
     * than in the decision panel, because a grill is a conversation the human is already
     * having and the question blocks it until it is answered.
     *
     * It FAILS CLOSED. A record that was not written is not ratified, because there is
     * nothing on disk to consent to and the approval would bind a text only the caller
     * has seen; a missing channel or an unreadable answer mints nothing. The proposal
     * and the reason are returned instead, so the caller can put the question itself.
     *
     * @param ingested - The `ingest` operation's result.
     * @param context - `{ root, exec }` — the project and the call whose agent is asked.
     * @returns The ingestion result, plus a `ratify` field holding the canonical
     *   ratification result and a `ratifyOutcome` string rendering it. When the record
     *   was not written, `ratify` carries `{ attempted: false, reason }` and nothing is
     *   minted.
     */
    const ratifyIngested = async (ingested, { root, exec }) => {
      const id = ingested?.adr?.id
      if (typeof id !== 'string' || id.length === 0 || ingested?.written === null || ingested?.written === undefined) {
        return {
          ...ingested,
          ratify: {
            attempted: false,
            reason:
              'the record was not written, so there is nothing to ratify: call again with write enabled, then the question can be put to the human',
          },
        }
      }
      const result = await ratifyInteractively({
        root,
        ids: [id],
        askedBy: askedByFor(exec),
        askHuman: humanChannel(exec),
        // A grilling session is the one entry whose question belongs in the Conversation:
        // the agent is talking to the human there, the human is expected to answer before
        // the session moves on, and making them leave the conversation to find the decision
        // panel is the wrong trade. Every other entry asks with the panel's presentation
        // intent, so the panel renders the question itself and the Conversation carries a
        // pointer to it instead of a second copy.
        present: 'chat',
      })
      return {
        ...ingested,
        ratify: result,
        ratified: result.ratified ?? [],
        ratifyOutcome: renderRatifyOutcome(result),
      }
    }

    /**
     * Builds the judge spawner a review or an ingestion runs on.
     *
     * Reached opportunistically through `ctx.get`, never through `inject` (see
     * SUBAGENTS_SERVICE). One closure for every caller, because a second copy is a
     * second place for the disposal contract to be forgotten — and `dispose()` is
     * mandatory: the run does not reach quiescence without it, so skipping it on the
     * cancellation path leaks the work being cancelled.
     *
     * @param exec - Tool-execution context; its agent is the judge's parent, which
     *   `start` requires, and its signal lets a cancelled tool call cancel the judge.
     * @returns An async `(prompt, outputSchema)` returning the judge's result, or
     *   `null` when this call cannot spawn one.
     */
    const judgeSpawner = (exec) => {
      const runtime = ctx.get(SUBAGENTS_SERVICE)
      const agent = exec?.agent
      if (runtime === undefined || agent === undefined) return null
      return async (prompt, outputSchema) => {
        const run = await runtime.start('spawn', {
          label: 'ratchet-judge',
          prompt: [{ type: 'text', text: prompt }],
          parent: agent,
          signal: exec.signal,
          outputSchema,
        })
        try {
          const result = await run.result
          return {
            structured: result.structured ?? null,
            output: textOf(result.output),
            stopReason: result.stopReason,
            diagnostic: result.diagnostic ?? null,
          }
        } finally {
          await run.dispose()
        }
      }
    }

    /**
     * Reports whether one call is made by a live ROOT agent.
     *
     * The auto-review a compile triggers is guarded by this, and the guard is not
     * cosmetic: a spawned judge is a full agent, so a judge that ran
     * `ratchet_compile` would trigger a review of its own, spawn another judge, and
     * repeat for as long as the models kept cooperating. The subagent runtime owns
     * the fact "this agent is a root"; asking it is exact where an in-process flag
     * would be a guess. A composition without the registry answers `false`, so the
     * conservative outcome — no automatic judge — is also the one that cannot
     * recurse.
     *
     * @param exec - Tool-execution context.
     * @returns `true` only when the registry confirms this agent is a runtime root.
     */
    const isRootCaller = (exec) => {
      const agents = ctx.get(AGENTS_SERVICE)
      const agent = exec?.agent
      if (agents === undefined || typeof agents.roots !== 'function' || agent === undefined) return false
      try {
        return agents.roots().includes(agent)
      } catch {
        return false
      }
    }

    register(
      defineTool({
        name: 'ratchet_status',
        description:
          'Report the ratchet state of this project without changing it: whether a manifest is present and ' +
          'ratchet-enabled, how many ADRs are active or proposed, the current spec hash, whether the ' +
          'persisted spec bundle is out of date, and whether the code has been verified against the laws ' +
          'currently in force. Call this first when you do not know whether a project uses the ratchet. ' +
          'It reports VERIFY_NOT_RUN when no verification covers the current laws, which is the difference ' +
          'between "checked and clean" and "never checked".',
        parameters: {
          root: {
            type: 'string',
            description:
              'Absolute path of the project to report on. Defaults to the session workspace, whose resolved path is in the result as `root` — pass this when you are working in a project other than the one the session was opened on, because the tools otherwise answer for the session workspace.',
          },
        },
        output: output(),
        execute(args, exec) {
          return withRoot(exec, status, args.root)
        },
      }),
    )

    register(
      defineTool({
        name: 'ratchet_bootstrap',
        description:
          'Create the manifest and directory skeleton a project needs before the ratchet can do anything. ' +
          'Use mode "preview" first: it returns the manifest text and the exact paths that would be ' +
          'created, and writes nothing. Use mode "apply" to write them. Existing files are never ' +
          'overwritten unless force is true, and every skipped path is reported.',
        parameters: {
          mode: {
            type: 'string',
            enum: ['preview', 'apply'],
            description: 'preview (default) reports the plan; apply writes it.',
          },
          name: { type: 'string', description: 'Project name recorded in the manifest.' },
          mainPaths: { type: 'string', description: 'Glob for the default zone, e.g. "src/**".' },
          force: { type: 'boolean', description: 'Overwrite existing files. Default false.' },
        },
        output: output(),
        execute(args, exec) {
          const mode = args.mode === 'apply' ? 'apply' : 'preview'
          // Bootstrap is the one operation that must work when nothing else does:
          // it takes the session workspace directly, because the manifest it is
          // about to create is the thing `withRoot` would have required.
          const { root } = rootFor(exec)
          return Promise.resolve(
            bootstrap({
              root,
              mode,
              name: args.name,
              mainPaths: args.mainPaths,
              force: args.force === true,
            }),
          )
        },
      }),
    )

    /**
     * Runs the corpus review a compile asked for, when this call can run one.
     *
     * The compiler does not guess at a semantic conflict: it marks the question and
     * records it. Leaving it there meant the mark was made and nothing ever acted on
     * it — a report that says "somebody should judge this" and no judgement — so a
     * compile now carries the review out itself.
     *
     * Three refusals are reported rather than passed over: the caller turned it off,
     * the composition has no judge, or the call did not come from a live root agent.
     * The third is the recursion guard, and it is the reason the result says
     * `ran: false` instead of silently doing nothing — a judge that compiles must not
     * start a review that spawns a judge.
     *
     * The review is ADVISORY and stays advisory here: it never changes the compile's
     * verdict, because a non-deterministic check that can fail a build is one people
     * learn to re-run until it passes.
     *
     * @param result - The compile result to annotate.
     * @param root - Absolute project root.
     * @param exec - Tool-execution context.
     * @param enabled - `false` when the caller passed `review: false`.
     * @returns The compile result, with a `dynamicReview` field describing what ran
     *   and what it found. Never throws: a failed judge is a reported outcome.
     */
    const reviewWhenRequired = async (result, root, exec, enabled) => {
      const questions = Array.isArray(result?.reviewRequired) ? result.reviewRequired : []
      if (enabled !== true || questions.length === 0) return result

      const rootCaller = isRootCaller(exec)
      const spawnJudge = rootCaller ? judgeSpawner(exec) : null
      if (spawnJudge === null) {
        return {
          ...result,
          dynamicReview: {
            ran: false,
            questions,
            reason: rootCaller
              ? 'this composition cannot spawn a judge, so the corpus review the compiler asked for was not run'
              : 'the caller is not a live root agent, so the ratchet did not spawn a judge from inside a judge; run the review from the session that owns this work',
          },
        }
      }

      const started = Date.now()
      const outcome = await review({ root, job: 'review_corpus', spawnJudge, record: true })
      return {
        ...result,
        dynamicReview: {
          ran: true,
          elapsedMs: Date.now() - started,
          advisory: outcome.advisory === true,
          gate: outcome.gate === true,
          findings: outcome.findings ?? [],
          problems: outcome.problems ?? [],
          questions,
          report: outcome.report ?? null,
        },
        nextStep:
          'the corpus review is advisory; ratchet_verify is the gate, and it is the compile problems above that a task has to clear',
      }
    }

    register(
      defineTool({
        name: 'ratchet_compile',
        description:
          'Compile the active architecture decision records into the laws the project enforces, and report ' +
          'every structural, authority and collision problem the corpus contains. Call this after adding or ' +
          'amending an ADR, and before implementing anything a decision governs. It always records its ' +
          'report and the machine-readable spec bundle; pass write: true to also emit the generated spec ' +
          'documents. It reports SPEC_HASH_MISMATCH when a generated document was edited by hand. When the ' +
          'compiler reports that a question needs judgement it also runs the corpus review and returns its ' +
          'findings under dynamicReview, which is advisory and never changes the compile verdict.',
        parameters: {
          write: {
            type: 'boolean',
            description:
              'Also write the generated spec documents under the manifest specs directory. Default false — ' +
              'the report and the spec bundle are recorded either way.',
          },
          review: {
            type: 'boolean',
            description:
              'Run the corpus review when the compiler reports that a question needs judgement. Default true; ' +
              'set false to keep the compile purely static and pay no judge round trip.',
          },
        },
        output: output(),
        execute(args, exec) {
          return withRoot(
            exec,
            async (root) => {
              const result = compile({ root, write: args.write === true })
              return reviewWhenRequired(result, root, exec, args.review !== false)
            },
            args.root,
          )
        },
      }),
    )

    register(
      defineTool({
        name: 'ratchet_verify',
        description:
          'Verify the codebase against the compiled laws: required and forbidden files, globs, text and ' +
          'dependencies, and zone path boundaries. This is deterministic — it asks no model — and it ' +
          'writes reports/ratchet/verify-report.json, recording the spec hash AND the code hash it judged. ' +
          'Every problem names the law, the file and the evidence, and a check that could not be evaluated ' +
          'is reported rather than passed. WHAT THIS TOOL CANNOT DO, so "done" is not claimed on its word: ' +
          'it supplies no command runner, so every `command` check comes back pending and the result is ' +
          'VERIFY_INCOMPLETE with ok:false however healthy the code is. A law whose enforcement is a ' +
          'command (a test suite, a lint, a script) therefore makes this tool a report and not a verdict — ' +
          '`node plugins/ratchet/ratchet-cli.mjs verify --root <project>` in a shell is the gate, and only ' +
          'that can return ok. Use this tool to see which laws exist and which filesystem checks hold.',
        parameters: {
          root: {
            type: 'string',
            description:
              'Absolute path of the project to verify. Defaults to the session workspace, whose resolved path is in the result as `root` — pass this when the project you changed is not the one the session was opened on.',
          },
        },
        output: output(),
        execute(args, exec) {
          return withRoot(exec, (root) => verify({ root }), args.root)
        },
      }),
    )

    register(
      defineTool({
        name: 'ratchet_ratify',
        description:
          'Put PROPOSED decisions to the human and record their consent. This is the only way a decision an agent ' +
          'proposed enters force THROUGH THE RATCHET: the ratchet asks the human one question per waiting record, ' +
          'showing that record\'s own text, and writes an approval ADR only when the answer selects that question\'s ' +
          'approve label — anything else is unreadable, is re-asked once in a different shape, and mints nothing. ' +
          'The consent is bound to a content hash of the text the human was shown, so editing an approved record — ' +
          'or editing it while the question is open — voids it until it is ratified again. There is deliberately NO ' +
          'argument that accepts an answer you composed: a consent this ratchet cannot check against a question it ' +
          'asked is a consent it cannot tell from a sentence an agent typed. The question does not appear as a chat ' +
          'quiz: it declares the ADR panel\'s presentation intent, so a client that has the panel puts the question in ' +
          'the decision window and the Conversation carries only a pointer to it — and if no client claims it, the ' +
          'harness\'s own card asks it in the Conversation, so it is never unanswerable. The one exception is a ' +
          'grilling session, which asks for the Conversation on purpose because the human is already talking there. ' +
          'It is not the only way a file can ' +
          'reach the corpus: a record whose frontmatter says `authority: human` self-activates, and a hand-written ' +
          'approval that reproduces the ratification block correctly is indistinguishable from this one — nothing ' +
          'in a file-based mechanism can tell them apart, so a human reading the diff is the check. If the human ' +
          'channel is unavailable here, the result says so and nothing is written.',
        parameters: {
          ids: {
            type: 'string',
            description:
              'Comma-separated ADR ids to ratify, e.g. "0001,0007". Default: every decision waiting for a human.',
          },
          root: {
            type: 'string',
            description:
              'Absolute path of the project whose decisions to put to the human. Defaults to the session workspace. Pass it when the record waiting for a human lives in another project: the question is about that project\'s text, and the approval is written into that project.',
          },
        },
        output: output(),
        execute(args, exec) {
          // An explicit `root` wins over the session workspace, for the same reason the read
          // side needs it: a session opened on one project could not put another project's
          // record to the human at all, so the only ways to approve that record were to open
          // a second session or to hand-write an approval — and a hand-written approval is
          // indistinguishable from a forged one. Measured: an agent working in a governed
          // game project could not ratify its own proposed record from the kit's session.
          const { root, found } =
            typeof args.root === 'string' && args.root.length > 0
              ? { root: resolve(args.root), found: true }
              : rootFor(exec)
          if (root === null || !found) {
            const problems = [
              {
                code: 'MANIFEST_MISSING',
                severity: 'error',
                subject: null,
                message:
                  root === null
                    ? `this session has no workspace directory, so there is nowhere to look for ${MANIFEST_PATH}`
                    : `no ${MANIFEST_PATH} found in ${root} or any parent, so this project declares no decisions to ratify`,
              },
            ]
            return Promise.resolve({
              ok: false,
              stage: 'ratify',
              reason: problems[0].message,
              problems,
              summary: summariseProblems(problems),
            })
          }

          const ids =
            typeof args.ids === 'string' && args.ids.trim().length > 0
              ? args.ids.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
              : null
          const askedBy = askedByFor(exec)

          // The question/answer/re-ask sequence is the operation's, so a probe can
          // drive the production path against a real channel and a test can drive it
          // with a literal answer. This adapter contributes only the channel — and
          // when there is none, the operation reports that rather than accepting an
          // answer from the model instead of the human.
          return ratifyInteractively({ root, ids, askedBy, askHuman: humanChannel(exec) })
        },
      }),
    )

    register(
      defineTool({
        name: 'ratchet_review',
        description:
          'Ask an INDEPENDENT judge agent whether something respects the project\'s decisions in meaning ' +
          'rather than in letter — the questions no static check can decide. Use it for a proposed ' +
          'decision, a code change, a conflict the compiler flagged, or to explain a violation. This is ' +
          'ADVISORY for everything except a CONTRADICTION: a finding that the change contradicts a decision in ' +
          'force in meaning — an error of kind semantic_violation or intent_violation naming a law — is recorded ' +
          'and the review DECLINES, and the write guard refuses writes in the zones that law governs until the ' +
          'change is fixed, the judged record is edited, or a human decides. Everything else it reports never ' +
          'changes whether work is done, and `ratchet_verify` remains the gate. ' +
          'Pass `verdict` instead of a job to file your own answer when no judge could be spawned. ' +
          'Findings that cite a law or ADR which does not exist are reported as unusable rather than ' +
          'passed on.',
        parameters: {
          job: {
            type: 'string',
            enum: Object.keys(REVIEW_JOBS),
            description:
              'What to review: review_corpus, review_change, review_proposal, review_conflict, ' +
              'explain_violation, or grill_preparation. Default review_corpus.',
          },
          change: { type: 'string', description: 'The proposed change or diff to review.' },
          proposal: { type: 'string', description: 'The proposed ADR text, for review_proposal.' },
          source: { type: 'string', description: 'The raw source the proposal came from.' },
          conflict: { type: 'string', description: 'The conflict to adjudicate, for review_conflict.' },
          violation: { type: 'string', description: 'The static violation to explain.' },
          question: { type: 'string', description: 'An extra question for the judge.' },
          verdict: {
            type: 'json',
            description:
              'Your own verdict, for the degraded path: {ok, findings:[{severity, kind, explanation, ' +
              'lawId?, sourceAdr?, suggestedAction?}]}. Used when you answered the prompt yourself.',
          },
        },
        output: output(),
        execute(args, exec) {
          const resolved = rootFor(exec)
          const job = typeof args.job === 'string' && args.job.length > 0 ? args.job : 'review_corpus'

          // Filing a verdict the caller produced. Validated exactly like a spawned
          // judge's, because the argument for checking a model's output applies at
          // least as strongly to output a model wrote by hand.
          if (args.verdict !== undefined && args.verdict !== null) {
            if (!resolved.found) {
              return Promise.resolve({
                ok: false,
                stage: 'review',
                advisory: true,
                reason: `no ${MANIFEST_PATH} found, so there are no laws to check the verdict against`,
              })
            }
            return Promise.resolve(
              submitReview({
                root: resolved.root,
                job,
                verdict: args.verdict,
                record: true,
                change: args.change ?? null,
                proposal: args.proposal ?? null,
                source: args.source ?? null,
              }),
            )
          }

          if (!resolved.found) {
            return Promise.resolve({
              ok: false,
              stage: 'review',
              advisory: true,
              reason: `no ${MANIFEST_PATH} found, so there are no decisions to review against`,
            })
          }

          // Reached opportunistically, never injected: see SUBAGENTS_SERVICE.
          return review({
            root: resolved.root,
            job,
            change: args.change ?? null,
            proposal: args.proposal ?? null,
            source: args.source ?? null,
            conflict: args.conflict ?? null,
            violation: args.violation ?? null,
            question: args.question ?? null,
            spawnJudge: judgeSpawner(exec),
            record: true,
          })
        },
      }),
    )

    register(
      defineTool({
        name: 'ratchet_ingest_source',
        description:
          'Turn a raw source of reasoning — a grilling transcript, a task brief, an investigation note — into a ' +
          'PROPOSED architecture decision record. It reads the source, has a judge extract the decision, its ' +
          'reasoning and the checks the decision implies, and verifies that every sentence the judge attributes to ' +
          'the source actually appears there: a justification or a check whose quoted basis is not in the source is ' +
          'refused or dropped rather than recorded. When the source states a decision without stating why, it returns ' +
          'INSUFFICIENT_REASONING and asks for the reasoning to be captured first. Nothing is written unless write is ' +
          'true, and the record it produces is always `proposed`: a human decides whether it becomes law, through ' +
          'ratchet_ratify. Pass `ingest` to file an answer you obtained yourself when no judge could be spawned. Pass ' +
          '`ratify` to end a grill session with the ratchet\'s own question: once the record is written, the same ' +
          'call puts it to the human through the question channel and records the approval.',
        parameters: {
          source: {
            type: 'string',
            description: 'Repository-relative path of the source file to ingest, e.g. docs/ratchet/sources/x.md.',
          },
          write: {
            type: 'boolean',
            description:
              'Write the generated ADR under the decisions directory. Default false — the record is returned ' +
              'for review first, and it is only written if it compiles.',
          },
          ingest: {
            type: 'json',
            description:
              'A result you produced for this source, in the shape the returned prompt asks for. It is validated ' +
              'exactly like a spawned judge\'s result, provenance checks included; use it when no judge could be spawned.',
          },
          ratify: {
            type: 'boolean',
            description:
              'After writing the record, put it to the human as the ratchet\'s own question in the same call — the ' +
              'grill-session entry to consent, and never a second channel: no value here accepts an answer. Fails ' +
              'closed, so nothing is approved when the record was not written, when no question channel is ' +
              'available, or when the answer cannot be read. Default false.',
          },
        },
        output: output(),
        async execute(args, exec) {
          const resolved = rootFor(exec)
          const sourcePath = typeof args.source === 'string' && args.source.length > 0 ? args.source : null
          if (sourcePath === null) {
            return {
              ok: false,
              stage: 'ingest',
              reason: 'ingestion needs the path of a source file holding the reasoning to record',
            }
          }
          if (!resolved.found) {
            return {
              ok: false,
              stage: 'ingest',
              reason: `no ${MANIFEST_PATH} found, so there is no decisions directory or zone list to record against; call ratchet_bootstrap first`,
            }
          }

          const ingested = await ingest({
            root: resolved.root,
            sourcePath,
            write: args.write === true,
            submitted: args.ingest ?? null,
            spawnJudge: judgeSpawner(exec),
          })
          if (args.ratify !== true) return ingested
          return ratifyIngested(ingested, { root: resolved.root, exec })
        },
      }),
    )

    // The `/ratify` command. It is the second ENTRY to the one consent channel, never a
    // second channel: the question is still the ratchet's and the answer is still derived
    // from the labels the human selected, so no argument here accepts an answer. Its value
    // over the tool is that a command is executed host-side without a model turn, so a UI
    // affordance that submits `/ratify <id>` reaches the human directly.
    //
    // Registered on the same effect as the tools, because it is the same adapter and the
    // same disposal contract: a hot reload replaces both registrations rather than
    // stacking a second command. The registration is caught separately, so a registry that
    // rejects the command cannot take the tools down with it.
    const commands = ctx.get(COMMANDS_SERVICE)
    if (commands !== null && commands !== undefined && typeof commands.register === 'function') {
      try {
        disposers.push(
          commands.register({
            name: 'ratify',
            description:
              'Put a proposed decision to the human as a question and record the answer; no argument accepts an answer, so the human answers the ratchet',
            input: { hint: '[<adr-id> …]' },
            handler: (invocation) => ratifyFromCommand(invocation),
          }),
        )
      } catch (error) {
        process.stderr.write(`ratchet: cannot register the /ratify command: ${String(error)}\n`)
      }
    }

    return () => {
      for (const dispose of disposers) dispose()
    }
  })
}

/**
 * Names who asked the human, for the approval's ratification block.
 *
 * The agent id IS the session id in this harness (`Agent.id` and `Session.id` are
 * the same branded value), so it identifies the conversation a consent was given
 * in. A call with no agent is recorded as `unattributed` rather than with an
 * invented name: an approval nobody can be asked about is a fact a reader should
 * see, and a plausible-looking substitute would hide it.
 *
 * @param exec - Tool-execution context.
 * @returns A non-empty string, either `session <id>` or `unattributed`.
 */
function askedByFor(exec) {
  const id = exec?.agent?.id
  if (typeof id !== 'string' || id.length === 0) return 'unattributed'
  // The harness already brands agent ids with a `session-` prefix, so prepending the
  // word produced `session session-<id>` in a durable record.
  return id.startsWith('session') ? id : `session ${id}`
}

/**
 * Parses the decision ids a `/ratify` invocation names.
 *
 * @param rawInput - The command's raw argument text, or any value.
 * @returns The ids named, or `null` when none were named — which the ratification
 *   operation reads as "every decision waiting for a human". Whitespace and commas
 *   both separate, so both `/ratify 0005 0007` and `/ratify 0005,0007` work. A
 *   non-string input yields `null` rather than throwing, because a command line is
 *   caller-supplied text.
 */
function parseRatifyIds(rawInput) {
  if (typeof rawInput !== 'string') return null
  const ids = rawInput
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return ids.length === 0 ? null : ids
}

/**
 * Reads the decision ids out of one field of a ratification result.
 *
 * @param entries - The result field: a list of id strings, of entries carrying an
 *   `id`, or any other value.
 * @returns The ids found, in order. Anything that carries no id is dropped, so a
 *   shape change in the operation renders as a shorter list rather than as
 *   `[object Object]` in a message a human reads.
 */
function ratifyIdsOf(entries) {
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
    .filter((id) => typeof id === 'string' && id.length > 0)
}

/**
 * Classifies a ratification result for the command registry.
 *
 * @param result - The canonical ratification result.
 * @returns `'success'` when a decision was ratified or the human declined
 *   deliberately — both are the command doing its job — and `'error'` for every
 *   outcome where the question was never put, could not be reached, or could not be
 *   read. A command must not report success for a consent it did not obtain.
 */
function ratifyOutcomeKind(result) {
  if (ratifyIdsOf(result?.ratified).length > 0) return 'success'
  if (ratifyIdsOf(result?.rejected).length > 0) return 'success'
  if (result?.nothingToRatify === true) return 'success'
  return 'error'
}

/**
 * Renders one ratification result as the text a command returns.
 *
 * @param result - The canonical ratification result.
 * @returns A single self-contained sentence (or two) naming what happened and
 *   whether anything was written. Never empty, so a command never settles with no
 *   explanation for the human who clicked it.
 */
function renderRatifyOutcome(result) {
  const ratified = ratifyIdsOf(result?.ratified)
  if (ratified.length > 0) {
    return `Ratified ${ratified.join(', ')}. The approval ADR and its transcript are written; compile and verify to see the new law set.`
  }
  if (result?.nothingToRatify === true) {
    return typeof result.message === 'string' && result.message.length > 0
      ? result.message
      : 'No decision is waiting for a human, so nothing was ratified.'
  }
  if (result?.askFailed === true) {
    return `Nothing was ratified: ${result.reason ?? 'the ratchet could not reach the human question channel'}. The question was never put to anyone.`
  }
  const rejected = ratifyIdsOf(result?.rejected)
  if (rejected.length > 0) {
    return `Not ratified: the human declined ${rejected.join(', ')}. Nothing was written, and the decisions stay proposed.`
  }
  const unreadable = ratifyIdsOf(result?.unreadable)
  if (unreadable.length > 0) {
    return `Nothing was ratified: the answer could not be read as approval or rejection for ${unreadable.join(', ')}.`
  }
  if (result?.needsAnswer === true) {
    return 'No decision is waiting for a human in this project, so no question was asked and nothing was written.'
  }
  const total = result?.summary?.total
  return typeof total === 'number' && total > 0
    ? `Nothing was ratified: ${String(total)} problem(s) stopped the operation.`
    : 'Nothing was ratified.'
}

/**
 * Concatenates the text blocks of a subagent result's output.
 *
 * A child asked for a schema answers through `structured` and may return empty
 * text, while a child that ignored the schema answers in text. Both are read, so
 * neither shape is mistaken for an empty verdict.
 *
 * @param content - Content blocks, or any value.
 * @returns The joined text, or an empty string.
 */
function textOf(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}
