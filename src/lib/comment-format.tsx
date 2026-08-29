import type { ReactNode } from "react";

/**
 * Markdown subset for comments: bold, italic, bullet lists.
 *
 * Returns React elements, never an HTML string, so there is no
 * dangerouslySetInnerHTML and injected markup renders as text.
 */

/** Guard against pathological input. */
const MAX_LENGTH = 10_000;

/** Bold is matched before italic so `**x**` is not read as italic-wrapped. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
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

/** Consecutive "- " lines become one list; everything else is a paragraph. */
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
