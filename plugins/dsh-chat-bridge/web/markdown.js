/*
 * PURPOSE
 *   Render the small, safe subset of Markdown an agent actually writes, as real DOM nodes. Agent
 *   output is untrusted data, so this module never builds markup from a string: it tokenises the
 *   text and constructs elements, which makes "an agent cannot turn its reply into markup or
 *   script in this app" a property of the construction rather than of a sanitiser being correct.
 *
 *   It exists because raw source is bad to read on a phone: `**bold**`, fenced blocks and lists
 *   are most of what an agent writes, and showing them literally makes the transcript harder to
 *   scan than the plain text would have been.
 *
 * INPUTS
 *   A string of message text.
 *
 * OUTPUTS
 *   `renderMarkdown(text)` returns a `DocumentFragment`. An empty or whitespace-only input returns
 *   an empty fragment. Nothing is ever parsed as HTML and no attribute is ever set from message
 *   text except a link's `href`, which is accepted only for `http:` and `https:`.
 *
 * KEYWORDS
 *   markdown, safe subset, DOM construction, XSS-free, transcript rendering, code block, list
 *
 * BEHAVIOUR ON EDGE CASES
 *   - An unterminated fenced block runs to the end of the message rather than swallowing nothing.
 *   - An unknown or mis-typed construct stays literal text, because showing the source is always
 *     better than dropping what the agent said.
 *   - A link whose target is not http(s) (including `javascript:` and `data:`) renders as plain
 *     text, so a link cannot execute anything when tapped.
 *   - Emphasis inside inline code is not interpreted: `` `a*b*c` `` keeps its asterisks.
 *   - Deeply nested emphasis is not supported and degrades to literal text, by design: a
 *     half-working parser is worse than a small honest one.
 */

/** The only URL schemes a rendered link may carry. */
const SAFE_SCHEMES = new Set(['http:', 'https:'])

/**
 * Create an element with text content and optional attributes.
 *
 * @param {string} tag - Tag name.
 * @param {string} [text] - Text, assigned as text (never parsed).
 * @param {Record<string, string>} [attributes] - Attributes to set.
 * @returns {HTMLElement} The element.
 */
function node(tag, text, attributes) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  for (const [name, value] of Object.entries(attributes ?? {})) element.setAttribute(name, value)
  return element
}

/**
 * Parse a link target, refusing anything that is not a plain web URL.
 *
 * @param {string} target - The raw target from `[text](target)`.
 * @returns {string|null} The href to use, or null to render as plain text.
 */
function safeHref(target) {
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return null
  }
  return SAFE_SCHEMES.has(parsed.protocol) ? parsed.href : null
}

/**
 * Render the inline constructs of one line of text into a fragment.
 *
 * Order matters: inline code is matched first so that its contents are never interpreted, and the
 * remaining emphasis is matched on what is left.
 *
 * @param {string} text - One line's text.
 * @returns {DocumentFragment} The rendered fragment.
 */
function renderInline(text) {
  const fragment = document.createDocumentFragment()
  // One pass, alternation ordered by precedence: code, bold, italic, link.
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/g
  let cursor = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) fragment.append(node('span', text.slice(cursor, match.index)))
    const token = match[0]
    if (token.startsWith('`')) {
      fragment.append(node('code', token.slice(1, -1)))
    } else if (token.startsWith('**') || token.startsWith('__')) {
      fragment.append(node('strong', token.slice(2, -2)))
    } else if (token.startsWith('*') || token.startsWith('_')) {
      fragment.append(node('em', token.slice(1, -1)))
    } else {
      const close = token.indexOf('](')
      const label = token.slice(1, close)
      const href = safeHref(token.slice(close + 2, -1))
      if (href === null) {
        // An unsafe or unparsable target keeps the whole construct as text rather than hiding it.
        fragment.append(node('span', token))
      } else {
        const anchor = node('a', label)
        anchor.href = href
        anchor.rel = 'noreferrer noopener'
        anchor.target = '_blank'
        fragment.append(anchor)
      }
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) fragment.append(node('span', text.slice(cursor)))
  return fragment
}

/**
 * Build the copy control that sits on a fenced code block.
 *
 * @param {string} code - The block's text.
 * @returns {HTMLElement} The button.
 */
function copyButton(code) {
  const button = node('button', 'Copy')
  button.type = 'button'
  button.className = 'copy'
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code)
      button.textContent = 'Copied'
    } catch {
      // A browser that refuses clipboard access (or a non-secure origin) must not break the view.
      button.textContent = 'Press and hold to copy'
    }
    setTimeout(() => {
      button.textContent = 'Copy'
    }, 1600)
  })
  return button
}

/**
 * Render one fenced code block.
 *
 * @param {string[]} lines - The block's lines, fence excluded.
 * @param {string} language - The fence's info string, when it named one.
 * @returns {HTMLElement} The `<pre>` wrapper.
 */
function codeBlock(lines, language) {
  const code = lines.join('\n')
  const wrapper = node('div')
  wrapper.className = 'code-block'
  if (language !== '') wrapper.append(node('span', language, { class: 'code-lang' }))
  wrapper.append(copyButton(code))
  const pre = node('pre')
  pre.append(node('code', code))
  wrapper.append(pre)
  return wrapper
}

/**
 * Render a list of items.
 *
 * @param {Array<{text: string, marker: string|null}>} items - The collected items.
 * @param {boolean} ordered - Whether to render an `<ol>`.
 * @returns {HTMLElement} The list element.
 */
function list(items, ordered) {
  const element = node(ordered ? 'ol' : 'ul')
  for (const item of items) {
    const li = node('li')
    li.append(renderInline(item.text))
    element.append(li)
  }
  return element
}

/**
 * Render Markdown into DOM nodes.
 *
 * @param {string} text - Message text.
 * @returns {DocumentFragment} The rendered content; empty for empty input.
 */
export function renderMarkdown(text) {
  const fragment = document.createDocumentFragment()
  if (typeof text !== 'string' || text.trim() === '') return fragment

  const lines = text.split('\n')
  let index = 0
  let paragraph = []

  /** Close the open paragraph, if any. */
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const p = node('p')
    p.append(renderInline(paragraph.join('\n')))
    fragment.append(p)
    paragraph = []
  }

  while (index < lines.length) {
    const line = lines[index]

    const fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line)
    if (fence !== null) {
      flushParagraph()
      const body = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        body.push(lines[index])
        index += 1
      }
      // An unterminated fence runs to the end rather than dropping the block it opened.
      index += 1
      fragment.append(codeBlock(body, fence[1] ?? ''))
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph()
      const level = Math.min(heading[1].length + 2, 6)
      const h = node(`h${String(level)}`)
      h.append(renderInline(heading[2]))
      fragment.append(h)
      index += 1
      continue
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph()
      fragment.append(node('hr'))
      index += 1
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph()
      const quoted = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      const quote = node('blockquote')
      quote.append(renderInline(quoted.join('\n')))
      fragment.append(quote)
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet !== null || numbered !== null) {
      flushParagraph()
      const ordered = numbered !== null
      const items = []
      const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/
      while (index < lines.length) {
        const item = pattern.exec(lines[index])
        if (item === null) break
        items.push({ text: item[1], marker: null })
        index += 1
      }
      fragment.append(list(items, ordered))
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      index += 1
      continue
    }

    paragraph.push(line)
    index += 1
  }
  flushParagraph()
  return fragment
}
