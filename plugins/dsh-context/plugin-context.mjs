/**
 * dsh-context: project context tools for any repository.
 *
 * Agents do not read documentation — they grep. That is not a flaw to correct but a trajectory to
 * use: an agent will reliably call a *tool*, because a tool is part of how it works, while it will
 * ignore a prose file about half the time and a documentation server almost always. This plugin
 * exposes a project's declared structure, rules and work orders as three tools, so the cheap path
 * and the correct path are the same path.
 *
 * It is deliberately project-agnostic. Nothing here names a language, package manager or test
 * runner: the project describes itself in `.dsh/project.json`, and the tools read whatever they
 * find. A Python project, a CMake project and a Unity project use the same three tools.
 *
 *   `context_module`  — which module owns a path, what it exports, what it links to.
 *   `context_rules`   — which rules bind this project, and what command fails if one is broken.
 *   `context_specs`   — what work is in flight, which paths it claims, and where scopes overlap.
 *
 * All logic lives in `context-core.mjs`; this file only registers it as tools, so the harness
 * dependency appears once and the logic is testable on its own.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { registerReconcileTool } from './reconcile-tool.mjs';
import {
  findProjectRoot,
  listSources,
  noManifest,
  readManifest,
  readModuleContract,
  readSpecs,
  sessionRoot,
  moduleIdFor,
  validateSpecs,
  withinRoot,
} from './context-core.mjs';

export const name = 'dsh-context';
export const inject = ['tools'];

/**
 * Resolves the project root for one tool call.
 *
 * The workspace comes from the session the call belongs to, never from the server's launch
 * directory: the harness is usually started from a home or app directory, so searching upward from
 * `process.cwd()` finds no manifest and every tool would report a missing project.
 *
 * @param exec - Tool-execution context supplied by the harness.
 * @returns Absolute project root, or `null` when no manifest is found.
 */
function rootFor(exec) {
  return findProjectRoot(sessionRoot(exec));
}

/** Registers the three project-context tools. */
export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'context_module',
      description:
        'Look up a module in this project: its stable identifier, owning package, declared purpose, ' +
        'declared links and declared exports, plus whether the exports match what the compiler reports. ' +
        'Use this before editing an unfamiliar file, or to find which module owns a path. Call it with ' +
        'no argument to list every module. Requires .dsh/project.json; if it reports a missing manifest, ' +
        'say so instead of guessing the structure.',
      parameters: {
        path: {
          type: 'string',
          description: 'Repository-relative path, or a suffix of one, to look up.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute(args, exec) {
        const root = rootFor(exec);
        if (root === null) {
          return Promise.resolve(noManifest(null));
        }
        const read = readManifest(root);
        if (read.error !== undefined) {
          return Promise.resolve({ ok: false, reason: read.error });
        }
        const sources = listSources(root, read.manifest);
        const selected =
          typeof args.path === 'string' && args.path.length > 0
            ? sources.filter((source) => source === args.path || source.endsWith(args.path))
            : sources;
        const modules = selected.slice(0, 60).map((source) => {
          const contract = readModuleContract(join(root, source));
          return {
            id: moduleIdFor(source),
            path: source,
            purpose: contract.purpose,
            links: contract.links,
            declaredExports: contract.exports,
          };
        });
        return Promise.resolve({
          ok: true,
          project: read.manifest.name,
          matched: modules.length,
          truncated: selected.length > modules.length,
          modules,
        });
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'context_rules',
      description:
        'List the rules this project claims, each with the command that fails when it is broken, and ' +
        'report any rule that names no working enforcement point. Use this to learn what is actually ' +
        'enforced here rather than assuming a convention holds, and to find the command that proves a ' +
        'change is acceptable. Pass a path to see only rules whose enforcement touches it.',
      parameters: {
        path: { type: 'string', description: 'Optional repository-relative path to filter by.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute(args, exec) {
        const root = rootFor(exec);
        if (root === null) {
          return Promise.resolve(noManifest(null));
        }
        const read = readManifest(root);
        if (read.error !== undefined) {
          return Promise.resolve({ ok: false, reason: read.error });
        }
        const manifest = read.manifest;
        const commands = new Map((manifest.verification ?? []).map((entry) => [entry.id, entry]));
        const rules = (manifest.rules ?? []).map((rule) => {
          const cited = rule.enforcedBy === null ? null : commands.get(rule.enforcedBy.command);
          // A citation is only an enforcement point if the command it names is declared *and* the file
          // implementing it is there. Reporting `enforced: true` over a missing implementation said a
          // rule was protected while nothing protected it — the exact failure this tool exists to
          // expose. The rule-bindings gate rejects both cases; the tool must not disagree with it.
          const declared = cited !== null && cited !== undefined;
          const implemented = declared && existsSync(join(root, String(cited.path ?? '')));
          const resolvable = declared && implemented;
          return {
            id: rule.id,
            statement: rule.statement,
            statedIn: rule.statedIn,
            enforced: resolvable,
            enforcedBy: !resolvable
              ? null
              : {
                  command: cited.command,
                  purpose: cited.purpose,
                  path: cited.path,
                },
            pendingReason: resolvable
              ? null
              : rule.enforcedBy === null
                ? (rule.pendingReason ??
                  'this rule names no enforcement point, and says nothing about why not')
                : !declared
                  ? `cites command "${rule.enforcedBy.command}", which the manifest does not declare, so nothing enforces this rule`
                  : `cites command "${cited.command}" implemented at ${String(cited.path)}, which does not exist, so nothing enforces this rule`,
          };
        });
        const filtered =
          typeof args.path === 'string' && args.path.length > 0
            ? rules.filter(
                (rule) => rule.enforcedBy === null || rule.enforcedBy.path.includes(args.path),
              )
            : rules;
        return Promise.resolve({
          ok: true,
          project: manifest.name,
          enforced: rules.filter((rule) => rule.enforced).length,
          pending: rules.filter((rule) => !rule.enforced).length,
          rules: filtered,
        });
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: 'context_specs',
      description:
        'List the work orders currently in flight in this project: what each one will achieve, which ' +
        'paths it may write, and what command proves it finished. Also reports every inconsistency it ' +
        'can decide, including two active specifications whose write paths overlap — which means their ' +
        'workers would edit the same files. Use this before starting work and before delegating any ' +
        'task, so two tasks are never handed out against the same paths.',
      parameters: {
        status: {
          type: 'string',
          description: 'Optional status to filter by.',
          enum: ['ready', 'in-flight', 'blocked', 'landed', 'cancelled'],
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute(args, exec) {
        const root = rootFor(exec);
        if (root === null) {
          return Promise.resolve(noManifest(null));
        }
        const read = readManifest(root);
        if (read.error !== undefined) {
          return Promise.resolve({ ok: false, reason: read.error });
        }
        const readResult = readSpecs(root);
        // The session root is passed so the tool runs the same filesystem checks the `specs` gate
        // runs. Without it the tool could report a clean spec set that the gate then rejects.
        const validation = validateSpecs(readResult.specs, read.manifest, root);
        const specs = readResult.specs
          .filter((spec) => args.status === undefined || spec.status === args.status)
          .map((spec) => ({
            id: spec.id,
            goal: spec.goal,
            status: spec.status,
            scope: (spec.scope ?? []).map((entry) => entry.path),
            acceptance: (spec.acceptance ?? []).map((entry) => entry.condition),
          }));
        return Promise.resolve({
          ok: true,
          project: read.manifest.name,
          specsTotal: readResult.specs.length,
          specs,
          problems: [...readResult.problems, ...validation.problems],
        });
      },
    }),
  );
  registerReconcileTool(ctx, rootFor, noManifest, readManifest);
}
