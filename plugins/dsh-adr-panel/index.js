/**
 * PURPOSE
 *   Node half of the ADR panel plugin. This package contributes browser
 *   presentation only; the host half exists so the Loader has a row to compose
 *   while the browser half ships through the package's `./client` export.
 *
 * INPUTS
 *   None. The harness composes this module for its `apply` export; it declares no
 *   configuration, no inject face and no services.
 *
 * OUTPUTS
 *   Exports an `apply` function that does nothing. It never throws and returns
 *   `undefined`, so a component that only adds browser UI cannot fail a boot.
 *
 * KEYWORDS
 *   host half, pure ui plugin, loader row, adr panel, no-op
 *
 * BEHAVIOUR ON EDGE CASES
 *   - Called with any arguments: ignored; the body is empty.
 *   - Composed in a profile with no browser: inert, because it registers nothing.
 */

/**
 * Host plugin body. Empty by design: the plugin's behaviour lives entirely in the
 * browser bundle resolved through the package's `./client` export.
 *
 * @returns Nothing.
 */
export function apply() {}
