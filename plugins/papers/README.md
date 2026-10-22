# @cc/dsh-papers

arXiv and Hugging Face paper research in one plugin, with no API key.

Three tools:

- **`papers_search`** — search arXiv, Hugging Face, or both. Returns title, authors,
  published date, abstract, page URL, PDF URL, arXiv categories, and HF upvotes /
  GitHub repo / AI summary when present. A failure of one source is reported in
  `errors` while the other source still returns results.
- **`papers_trending`** — the Hugging Face daily papers, newest first. Use it to see
  what is new before narrowing a review.
- **`papers_download`** — fetch an arXiv PDF into `<workspace>/.dsh/papers/`, then
  run `pdftotext` when it is installed. Returns the PDF path, text path, a
  6,000-character preview and warnings. A missing `pdftotext` does not fail the
  download.

## Endpoints

| Use | Endpoint |
|---|---|
| arXiv search | `https://export.arxiv.org/api/query` (Atom) |
| Hugging Face search | `https://huggingface.co/api/papers/search?q=…&limit=…` |
| Hugging Face daily | `https://huggingface.co/api/daily_papers?limit=…` |
| arXiv PDF | `https://arxiv.org/pdf/<id>` |

The tools send a descriptive `User-Agent`, a 20-second timeout, and no credentials.
`limit` is per source and capped at 25. arXiv `author` and `category` filters apply
to arXiv only; `sort` is arXiv only. Hugging Face uses its own relevance order.

## Failure modes, stated

- arXiv asks for a contact in its user agent for heavy use; this deployment is
  light, one call per review step.
- Hugging Face papers are arXiv-centric; a paper without an arXiv-style id has no
  `pdfUrl` and `papers_download` will not accept it.
- `papers_download` writes only inside the session workspace `.dsh/papers/`, rejects
  path traversal and caps a PDF at 30 MB.
- `pdftotext` is an optional local binary. Without it the PDF is still saved; the
  tool says so in `warnings`.

## Proof

The plugin was proved with live calls: two arXiv results and two Hugging Face
results for `retrieval augmented generation`, and a daily-papers call. The direct
tool execution and the mounted row were checked separately. No autotest was added;
the product calls are the evidence.
