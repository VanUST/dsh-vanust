# Visual explanations

The kit has four rendering surfaces — `presentation`, `diagram`, `handoff`, `explain-webpage` — plus the option of real animation. They are not interchangeable: each answers a different reader question. Choose the artifact from the question, then make every artifact from the same family look like it came from one hand.

## Pick the artifact

| The reader's question | Artifact | Tool |
|---|---|---|
| "What was decided, and on what evidence?" | one-page record | `handoff` |
| "Walk me through it in order" | deck, one idea per slide | `presentation` |
| "How do these parts relate / what is the lifecycle?" | diagram (flow, state, arch, sequence) | `diagram` |
| "What happens if I change this input?" | interactive page with controls | skill `explain-webpage` |
| "Show me how it moves / transforms" | animation or staged frames | Manim, or staged diagrams |

A handoff is a **record**, not a story: it must fit one A4 page, and the tool now tells you when it does not. A deck is a **performance**: it may not survive printing. A diagram is a **map**: it holds no prose. Choosing wrong is why documents look bad — a deck used as a record is unreadable, a handoff used as a story is cramped.

## One visual system, every artifact

Before the first frame, fix the system and reuse it:

- **Palette: four roles, not six colours.** `ink` (primary text), `muted` (labels, axes), `accent` (the one thing being discussed), `danger` (a failure). Everything else is a neutral surface. Pick one of the kit's themes — `ember`, `graphite`, `aurora`, `mono`, `paper` — and keep it across a series, so three diagrams read as one document.
- **Type: two sizes beyond the title.** A title sentence, one body size, one caption size. Hierarchy comes from size, weight and space, not from colour.
- **Space on a 4/8 grid.** If two elements are not aligned to the same grid, they look wrong without the viewer knowing why.
- **Radius and elevation: one value each.** Mixed radii are the fastest way to look generated.
- **Motion: 150–250 ms, ease-out.** Anything slower reads as lag; anything bouncy reads as a demo.

## The 3Blue1Brown pattern, as rules an agent can follow

The value in those videos is not the animation engine; it is a sequence discipline. Distilled:

1. **One idea per frame, stated as a sentence.** The title says what the viewer should conclude ("the gradient points uphill"), not what the box contains ("Gradient").
2. **Show the transformation, not the result.** Keep the "before" on screen while the "after" arrives, so the change is the visible event. A result alone teaches nothing about why it is the result.
3. **Concrete first, general second.** Start with one worked example; keep it on screen as the anchor while the general rule appears beside it.
4. **Persistent anchor.** One element stays put across frames (a row, a point, a box) so the viewer can tell what moved.
5. **Pace for reading.** Two seconds minimum per short line; captions restate the narration in the viewer's own reading order.
6. **Colour carries one meaning.** Accent marks the subject of the current idea and nothing else; repeated use of accent for different things destroys the signal.
7. **No decorative motion.** Every animation answers "what changed, and why does it matter". If removing it loses nothing, remove it.
8. **Verify with the captions covered.** Follow the motion alone. If the idea does not arrive, the frames are wrong, not the wording.

Write the storyboard before rendering: for each frame, list `anchor`, `change`, `caption`. Three to seven frames is an explanation; twenty is a film.

## Doing it with the kit's tools

- **`diagram`** — `sequence` for a protocol or a request path, `state` for a lifecycle, `arch` for layers and boundaries, `flow` for a decision. Caps that keep it legible: ≤ 9 nodes, ≤ 3 ranks wide, labels under ~30 characters, edges labelled with verbs. For before/after, prefer two diagrams with identical structure, or one diagram with a dashed edge labelled `then`.
- **`presentation`** — one idea per slide, ≤ 5 cards, the kicker names the section so a reader can skim. The deck is HTML the preview renders; keep it print-readable if anyone will PDF it.
- **`handoff`** — the record: TL;DR, objective, what changed, evidence, decisions, risks, next. It refuses nothing, but it warns when the page overflows; trim items rather than shrinking type.
- **Staged frames without an animation engine** — render 3–5 diagrams of the same scene, then step through them in a self-contained page (CSS transitions, a "step" button, keyboard arrows). The Sidebar preview runs scripts, so this is a real animation surface at a fraction of the cost.
- **Manim, when motion *is* the explanation** — Manim Community (`pip install manim`, or `uv tool install manim`) renders scenes to MP4 and needs `ffmpeg` plus cairo/pango. A scene is a Python class: build mobjects (`Text`, `MathTex`, `Axes`, `Arrow`), then `self.play(Create(ax), Transform(before, after))`. Use it when the deliverable is a video people will watch; otherwise the HTML route is cheaper, previewable and diffable.

## Verify the artifact, do not assume it

Render it, then look: open the file, screenshot it at 100%, read the smallest label, check the print view if it is A4, and check every accent colour means the same thing. A visual that must be explained in chat has failed as a visual. Quote the file path and its size in the report — "rendered" is a claim; the path is evidence.

## Anti-patterns

- Prose inside boxes; if the nodes are sentences, the diagram wants to be a paragraph.
- More than nine nodes, or more than one concept per slide.
- A rainbow: colour that distinguishes categories the viewer does not need to distinguish.
- Centred body paragraphs; ragged-right is easier to read.
- Motion that repeats the same state, or animates the arrival of text the viewer could have read instantly.
- Decorative illustration in a record; the handoff is read for the decision.
- A deck printed to A4 without checking it.

## Sources

Method distilled for this deployment from 3Blue1Brown's published explainers and Manim Community's documentation (<https://www.manim.community/>, scene/mobject model and `manim` CLI); the tool contracts are the kit's own (`diagram`, `presentation`, `handoff`, `explain-webpage`).
