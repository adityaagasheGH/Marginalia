import type { ReactNode } from "react";

/**
 * A deliberately tiny markdown subset for comments: **bold**, *italic*, and
 * "- " bullet lists. Nothing else.
 *
 * Why hand-written instead of react-markdown + rehype-sanitize (which
 * docs/SECURITY.md § 6 suggests): sanitizing means generating an HTML string
 * and then filtering the dangerous parts out of it, which requires
 * dangerouslySetInnerHTML and stays safe only while the allowlist is
 * airtight. This renderer never produces an HTML string at all — it returns
 * React elements, and React escapes every string it renders. A comment
 * containing <script>alert(1)</script> becomes visible text, because there is
 * no code path here that could turn it into markup.
 *
 * The tradeoff is honest: no links, headings, code blocks, or images. The
 * feature asked for three formats, and this supports exactly those three.
 */

/** Longest run of text we will scan. Guards against pathological input. */
const MAX_LENGTH = 10_000;

/**
 * Parse inline markers within a single line.
 *
 * Bold is matched before italic so `**text**` is not mistaken for an italic
 * `*` wrapping `*text*`. The regex requires non-empty content, so a stray
 * `**` in prose stays literal rather than swallowing the rest of the line.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Alternation order matters: ** before *, __ before _.
  const pattern = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1|(\*|_)(?=\S)(.+?)(?<=\S)\3/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const boldContent = match[2];
    const italicContent = match[4];

    if (boldContent !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
          {boldContent}
        </strong>,
      );
    } else if (italicContent !== undefined) {
      nodes.push(<em key={`${keyPrefix}-i${i}`}>{italicContent}</em>);
    }

    lastIndex = pattern.lastIndex;
    i++;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * Render a comment body.
 *
 * Block handling is line-based: consecutive lines starting with "- " or "* "
 * collect into one <ul>; everything else becomes a paragraph. Blank lines
 * separate paragraphs and close a list.
 */
export function renderCommentBody(body: string): ReactNode {
  const source = body.slice(0, MAX_LENGTH);
  const lines = source.split("\n");

  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let paragraph: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`ul${key++}`} className="list-disc space-y-0.5 pl-5">
        {items.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li${key}-${idx}`)}</li>
        ))}
      </ul>,
    );
  };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n");
    paragraph = [];
    blocks.push(
      <p key={`p${key++}`} className="whitespace-pre-wrap">
        {renderInline(text, `p${key}`)}
      </p>,
    );
  };

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      continue;
    }
    if (line.trim() === "") {
      flushList();
      flushParagraph();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushList();
  flushParagraph();

  return <div className="space-y-2">{blocks}</div>;
}
