# UI builder

Build the smallest interface that answers the user's question, then prove it in a browser.

## The loop

1. **Read before writing.** Find the design tokens, the component directory, the page patterns, and the existing primitives. Name what you will reuse. If the repo has a component library, the answer is a composition, not a new component.
2. **Choose the smallest page.** One primary action, one main path, one empty state. No new dependency for a few lines (use the Ponytail ladder).
3. **Implement semantics first.** Labels, roles, focus order, keyboard operation, reduced motion, contrast. A div with a click handler is not a button.
4. **Run it.** Start the dev server and note the exact URL. Use the Playwright MCP to navigate, take an accessibility snapshot, and screenshot at 1440, 768 and 390 CSS pixels.
5. **Inspect what the browser says.** Console errors, failed requests, overflow, focus traps, missing alt text, dark/light, loading/empty/error states. Compare against the design, not against your memory of it.
6. **Fix and re-render.** One change at a time; re-check the same states. Do not declare done from source code.
7. **Hand off.** Present the screenshots and the URL; state what was checked and what could not be checked. Write the reusable rule into the repo's design notes if there is one.

## Checks that are not optional

- Keyboard: every control reachable, visible focus, Escape closes overlays, no focus trap.
- Narrow screen: no horizontal scroll; the primary action stays reachable.
- States: loading, empty, error, and a long value all render.
- Theme: the page reads correctly in light and dark; use the host's theme tokens, not literal colors.
- Console: zero errors and no failed requests caused by the page.

## MCPs

Playwright is the only always-on UI MCP. Figma, shadcn, Storybook and Chrome DevTools are optional and should be enabled per project, not globally: every server's tool schemas enter every request while mounted. Use Figma when the source is a Figma frame, shadcn on a shadcn project, Storybook when the repo has stories, Chrome DevTools when the question is performance.
