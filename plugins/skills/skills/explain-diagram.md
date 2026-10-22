# Explain with a diagram

A diagram can be easier to understand than prose.

1. Identify the question the reader needs to answer. Choose a flow, relationship, comparison, or sequence that makes the answer visible.
2. Use the `diagram` tool in this deployment. Give it a JSON spec; it computes the layout and writes a standalone HTML file with inline SVG. Use `kind: "flow"` for a process, `"arch"` for a system, `"sequence"` for message order, `"state"` for a lifecycle. Read the tool result: `ok` only means a file was written; `degraded: true` means `errors` is non-empty.
3. Give each shape one idea. Use short, concrete labels and explicit arrow directions. Label decisions and feedback loops. Use color only when it has meaning.
4. Read the diagram as a newcomer. Check text size, overlap, arrow endpoints, and whether the main path is obvious. Correct the spec and render again.
5. Return the file and a brief explanation of how to read it. Use `present` so the Sidebar preview shows it.

Use the fewest shapes that preserve the important relationships. Keep uncertainty visible. Create the requested artifact without turning the explanation into a report.
