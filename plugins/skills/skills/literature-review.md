# Literature review

Turn a research question into a short, cited comparison, not an abstract dump.

1. **Sharpen the question.** State what decision the review informs. If it is vague, run one `grilling` round first.
2. **Search three ways.** Use the `papers_search` tool with different vocabulary (problem name, method name, application). Set `source: "both"` so arXiv and Hugging Face are covered; use `papers_trending` for what is new. A failed source comes back in `errors` with the other source still populated.
3. **Shortlist by title and abstract.** Keep 5–10 candidates. Exclude anything that does not answer the question, and say why in one line if the exclusion is not obvious.
4. **Read the shortlist.** Use `papers_download` on the arXiv id; it saves the PDF under `.dsh/papers/` and returns `textPath` plus a `textPreview` when `pdftotext` is installed. Read the method, data, result and limitation; do not trust the abstract for the result.
5. **Compare.** One table row per paper: problem, method, data, result, limitation. Quote numbers with their setting; do not compare a benchmark result to a different benchmark.
6. **Write the handoff.** Use `clear-writing`: the main finding first, then the evidence, then what is still unknown. Cite every claim with title, authors, year and arXiv/HF id. Use `diagram` if the comparison is relational.
7. **Stop.** A literature review is not a survey; it answers the question that started it. Name what you did not read.

Never invent a citation. If a paper cannot be fetched, say so and leave it out of the comparison.
