import { useState, useEffect, useMemo } from 'react';
import type { SuggestionItem } from '@shared/types';

interface AnswerCardProps {
  answer: SuggestionItem | null;
  isGenerating: boolean;
  onRegenerate?: (question: string) => void;
  onClear?: () => void;
}

const FORMAT_LABELS: Record<string, { label: string; icon: string; badgeClass: string }> = {
  interview: { label: 'Interview Answer', icon: '🎯', badgeClass: 'format-badge--interview' },
  star: { label: 'STAR Framework', icon: '⭐', badgeClass: 'format-badge--star' },
  technical: { label: 'Technical Explanation', icon: '💡', badgeClass: 'format-badge--tech' },
  direct: { label: 'Direct Answer', icon: '⚡', badgeClass: 'format-badge--direct' },
  meeting: { label: 'Meeting Insight', icon: '📋', badgeClass: 'format-badge--meeting' },
  points: { label: 'Talking Points', icon: '💬', badgeClass: 'format-badge--points' },
  followup: { label: 'Follow-Up', icon: '🔍', badgeClass: 'format-badge--followup' },
};

const DEFAULT_FORMAT = { label: 'Technical Explanation', icon: '💡', badgeClass: 'format-badge--tech' };

export function AnswerCard({ answer, isGenerating, onRegenerate, onClear }: AnswerCardProps) {
  const [copied, setCopied] = useState(false);
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
      // Fallback
      setCopied(false);
    }
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
        elements.push(
          <pre key={`code-${elements.length}`} className="answer-code-block">
            <code>{codeLines.join('\n')}</code>
          </pre>,
        );
        codeLines = [];
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
  }, [displayedContent]);

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
      <div className="answer-body" role="region" aria-live="polite">
        {renderedContent}
        {isGenerating && (
          <div className="answer-loading-indicator">
            <span className="pulse-dot" />
            <span className="pulse-text">Generating answer with Gemini…</span>
          </div>
        )}
      </div>
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
