import { memo, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { parseMarkdown } from '@shared/markdown';
import type { Block, Inline } from '@shared/markdown';
import { Icon } from './Icon';

function renderInline(nodes: Inline[], keyPrefix: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.t) {
      case 'text':
        return n.v;
      case 'bold':
        return <strong key={key}>{renderInline(n.c, `${key}-`)}</strong>;
      case 'italic':
        return <em key={key}>{renderInline(n.c, `${key}-`)}</em>;
      case 'code':
        return <code key={key}>{n.v}</code>;
      case 'link':
        // Opens in the user's browser via the main-process window-open handler (https only).
        return (
          <a key={key} href={n.href} target="_blank" rel="noreferrer noopener">
            {renderInline(n.c, `${key}-`)}
          </a>
        );
    }
  });
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="md-code">
      <div className="md-code__bar">
        <span className="md-code__lang">{lang || 'code'}</span>
        <button type="button" className="btn btn--ghost btn--xs" onClick={() => void copy()} aria-label={copied ? 'Code copied' : `Copy ${lang || 'code'} block`}>
          <Icon name={copied ? 'check' : 'copy'} size={13} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderBlock(b: Block, i: number): ReactNode {
  const key = `b${i}`;
  switch (b.t) {
    case 'heading': {
      // Answers live under the panel's own heading, so Markdown h1 starts at h3.
      const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[b.level - 1] ?? 'h6';
      return (
        <Tag key={key} className={`md-h md-h${b.level}`}>
          {renderInline(b.c, key)}
        </Tag>
      );
    }
    case 'paragraph':
      return <p key={key}>{renderInline(b.c, key)}</p>;
    case 'list': {
      const items = b.items.map((item, j) => <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}-`)}</li>);
      return b.ordered ? (
        <ol key={key} start={b.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case 'code':
      return <CodeBlock key={key} lang={b.lang} code={b.v} />;
    case 'quote':
      return <blockquote key={key}>{renderInline(b.c, key)}</blockquote>;
    case 'table':
      return (
        <div key={key} className="md-table" tabIndex={0} role="region" aria-label="Table">
          <table>
            <thead>
              <tr>
                {b.head.map((cell, j) => (
                  <th key={j} scope="col">
                    {renderInline(cell, `${key}-h${j}-`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, j) => (
                    <td key={j}>{renderInline(cell, `${key}-${r}-${j}-`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr key={key} />;
  }
}

/** Renders AI Markdown as React elements. No HTML string is ever injected. */
export const Markdown = memo(function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return <div className="md">{blocks.map(renderBlock)}</div>;
});
