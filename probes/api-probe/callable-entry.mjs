/**
 * PURPOSE
 *   Loader entry for the callable-surface probe, split out because Cordis has no
 *   config selector for which export of a module becomes the plugin: a loader
 *   row takes the module's default (or its `apply` member). One module therefore
 *   serves exactly one plugin, and a second probe needs a second entry file.
 *
 *   That constraint was measured, not assumed: declaring `config: { export:
 *   applyCallable }` on a row failed the whole tree with "invalid plugin, expect
 *   function or object with an \"apply\" method, received object".
 *
 * INPUTS
 *   None. Imported by absolute `file:` URL from the probe home's patch layer.
 *
 * OUTPUTS
 *   Re-exports the callable probe's plugin identity (`name`, `inject`) and
 *   exposes it as `apply`.
 *
 * KEYWORDS
 *   cordis plugin entry, loader row, function plugin, probe wiring
 *
 * BEHAVIOUR ON EDGE CASES
 *   None: this module only re-binds an export and holds no state.
 */
export { name, inject, applyCallable as apply } from './callable.mjs'
