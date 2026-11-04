import { useState, useEffect, useMemo } from 'react';
import type { SuggestionItem } from '@shared/types';

interface AnswerCardProps {
  answer: SuggestionItem | null;
  isGenerating: boolean;
  onRegenerate?: (question: string) => void;
  onClear?: () => void;
  onAskFollowUp?: (question: string) => void;
}

const FORMAT_LABELS: Record<string, { label: string; icon: string; badgeClass: string }> = {
  interview: { label: 'Interview Answer', icon: '🎯', badgeClass: 'format-badge--interview' },
  star: { label: 'STAR Framework', icon: '⭐', badgeClass: 'format-badge--star' },
  technical: { label: 'Technical Explanation', icon: '💡', badgeClass: 'format-badge--tech' },
  direct: { label: 'Direct Answer', icon: '⚡', badgeClass: 'format-badge--direct' },
  meeting: { label: 'Meeting Insight', icon: '📋', badgeClass: 'format-badge--meeting' },
  points: { label: 'Talking Points', icon: '💬', badgeClass: 'format-badge--points' },
  followup: { label: 'Follow-Up', icon: '🔍', badgeClass: 'format-badge--followup' },
  code: { label: 'Code Implementation', icon: '💻', badgeClass: 'format-badge--code' },
  dsa: { label: 'DSA Problem Solution', icon: '🧩', badgeClass: 'format-badge--dsa' },
};

const DEFAULT_FORMAT = { label: 'Technical Explanation', icon: '💡', badgeClass: 'format-badge--tech' };

export function AnswerCard({ answer, isGenerating, onRegenerate, onClear, onAskFollowUp }: AnswerCardProps) {
  const [copied, setCopied] = useState(false);
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [displayedContent, setDisplayedContent] = useState('');

  // Smooth typing effect when a fresh answer arrives
  useEffect(() => {
    if (!answer?.content) {
      setDisplayedContent('');
      return;
    }

    const fullText = answer.content;
    // If the text is short, reveal quickly; if longer, reveal in rapid batches
    let currentLength = 0;
    const chunkSize = Math.max(3, Math.floor(fullText.length / 30));
    setDisplayedContent(fullText.slice(0, chunkSize));

    const interval = setInterval(() => {
      currentLength += chunkSize;
      if (currentLength >= fullText.length) {
        setDisplayedContent(fullText);
        clearInterval(interval);
      } else {
        setDisplayedContent(fullText.slice(0, currentLength));
      }
    }, 15);

    return () => clearInterval(interval);
  }, [answer?.id, answer?.content]);

  const handleCopy = async () => {
    if (!answer?.content) return;
    try {
      await navigator.clipboard.writeText(answer.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleCopyCode = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCodeIdx(idx);
      setTimeout(() => setCopiedCodeIdx(null), 2000);
    } catch {}
  };

  const handleRegenerate = () => {
    if (!answer) return;
    const q = answer.question || answer.title;
    if (q && onRegenerate) {
      onRegenerate(q);
    }
  };

  const formatConfig = useMemo(() => {
    const key = answer?.formatType || 'interview';
    return FORMAT_LABELS[key] ?? DEFAULT_FORMAT;
  }, [answer?.formatType]);

  // Clean Markdown block renderer
  const renderedContent = useMemo(() => {
    if (!displayedContent) return null;

    const lines = displayedContent.split('\n');
    const elements: JSX.Element[] = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeLines: string[] = [];
    let listItems: string[] = [];

    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`ul-${elements.length}`} className="answer-list">
            {listItems.map((item, idx) => (
              <li key={idx} dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
            ))}
          </ul>,
        );
        listItems = [];
      }
    };

    const flushCodeBlock = () => {
      if (codeLines.length > 0) {
        const fullCode = codeLines.join('\n');
        const blockIdx = elements.length;
        const langDisplay = codeLanguage || answer?.programmingLanguage || 'code';
        elements.push(
          <div key={`code-${blockIdx}`} className="answer-code-container">
            <div className="answer-code-bar">
              <span className="answer-code-lang">{langDisplay}</span>
              <button
                type="button"
                className="answer-code-copy-btn"
                onClick={() => handleCopyCode(fullCode, blockIdx)}
              >
                {copiedCodeIdx === blockIdx ? '✓ Copied' : 'Copy Code'}
              </button>
            </div>
            <pre className="answer-code-block">
              <code>{fullCode}</code>
            </pre>
          </div>,
        );
        codeLines = [];
        codeLanguage = '';
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          flushCodeBlock();
          inCodeBlock = false;
        } else {
          flushList();
          inCodeBlock = true;
          codeLanguage = line.trim().replace(/^```/, '').trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      const trimmed = line.trim();

      // Heading (### or ##)
      if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
        flushList();
        const text = trimmed.replace(/^#+\s*/, '');
        elements.push(
          <h4 key={`h-${i}`} className="answer-subheading">
            {text}
          </h4>,
        );
        continue;
      }

      // Bullet points
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
        const itemText = trimmed.replace(/^([-*]|\d+\.)\s*/, '');
        listItems.push(itemText);
        continue;
      }

      // Empty line / paragraph separator
      if (!trimmed) {
        flushList();
        continue;
      }

      // Regular paragraph
      flushList();
      elements.push(
        <p
          key={`p-${i}`}
          className="answer-paragraph"
          dangerouslySetInnerHTML={{ __html: formatInline(line) }}
        />,
      );
    }

    flushList();
    flushCodeBlock();

    return elements;
  }, [displayedContent, copiedCodeIdx, answer?.programmingLanguage]);

  if (!answer && !isGenerating) {
    return (
      <div className="answer-panel answer-panel--empty">
        <div className="answer-empty-icon" aria-hidden="true">
          ✦
        </div>
        <div className="answer-empty-text">
          <strong>AI Copilot Ready</strong>
          <span>Ask anything below or speak to receive live, structured answers.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`answer-panel${isGenerating ? ' answer-panel--generating' : ''}`}>
      {/* ── Top Bar: Format Badge & Action Buttons ── */}
      <div className="answer-header">
        <div className="answer-badge-group">
          {answer?.hasVisualContext && (
            <span
              className="format-badge format-badge--vision"
              title="Generated using Gemini Vision on captured screen"
            >
              <span className="format-badge__icon">🖼️</span>
              Screen Vision
            </span>
          )}
          {answer?.programmingLanguage && (
            <span className="format-badge format-badge--lang">
              {answer.programmingLanguage.toUpperCase()}
            </span>
          )}
          <span className={`format-badge ${formatConfig.badgeClass}`}>
            <span className="format-badge__icon">{formatConfig.icon}</span>
            {formatConfig.label}
          </span>
          {answer?.title && <span className="answer-title-tag">{answer.title}</span>}
        </div>

        <div className="answer-actions">
          {onRegenerate && (
            <button
              type="button"
              className="action-btn"
              onClick={handleRegenerate}
              disabled={isGenerating}
              title="Regenerate this answer"
              aria-label="Regenerate answer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
              </svg>
            </button>
          )}

          <button
            type="button"
            className={`action-btn${copied ? ' action-btn--active' : ''}`}
            onClick={handleCopy}
            title={copied ? 'Copied to clipboard' : 'Copy answer'}
            aria-label="Copy answer"
          >
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>

          {onClear && (
            <button
              type="button"
              className="action-btn action-btn--dismiss"
              onClick={onClear}
              title="Dismiss answer"
              aria-label="Dismiss answer"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── Question Context ── */}
      {answer?.question && (
        <div className="answer-question">
          <span className="question-prefix">Q:</span>
          <span className="question-text">{answer.question}</span>
        </div>
      )}

      {/* ── Formatted Answer Body ── */}
      <div
        className={`answer-body${!isExpanded ? ' answer-body--collapsed' : ''}`}
        role="region"
        aria-live="polite"
      >
        {renderedContent}
        {isGenerating && (
          <div className="answer-loading-indicator">
            <span className="pulse-dot" />
            <span className="pulse-text">Generating answer with Gemini…</span>
          </div>
        )}
      </div>

      {/* ── Expand/Collapse for long answers ── */}
      {answer?.content && answer.content.length > 500 && (
        <div className="answer-expand-bar">
          <button
            type="button"
            className="answer-expand-btn"
            onClick={() => setIsExpanded((prev) => !prev)}
          >
            {isExpanded ? '▲ Collapse' : '▼ Expand Full Answer'}
          </button>
        </div>
      )}

      {/* ── Quick Follow-Up Questions ── */}
      {answer?.followUpSuggestions && answer.followUpSuggestions.length > 0 && (
        <div className="answer-followups">
          <span className="answer-followups__label">Follow-ups:</span>
          <div className="answer-followups__list">
            {answer.followUpSuggestions.map((fu, idx) => (
              <button
                key={idx}
                type="button"
                className="answer-followup-pill"
                onClick={() => onAskFollowUp?.(fu)}
                title={`Ask: "${fu}"`}
              >
                💬 {fu}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Utility to format bold, inline code, and highlights safely */
function formatInline(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
}
