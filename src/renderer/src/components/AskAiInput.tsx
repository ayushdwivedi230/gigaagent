import { useState, useRef } from 'react';

interface AskAiInputProps {
  onAsk: (question: string) => void;
  isGenerating: boolean;
  autoAnswer: boolean;
  onToggleAutoAnswer: (val: boolean) => void;
  hasVisualContext?: boolean;
}

export function AskAiInput({
  onAsk,
  isGenerating,
  autoAnswer,
  onToggleAutoAnswer,
  hasVisualContext = false,
}: AskAiInputProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGenerating) return;
    const clean = query.trim();
    if (clean) {
      onAsk(clean);
      setQuery('');
    } else if (hasVisualContext) {
      onAsk('Analyze this captured screen, solve any problem or error shown, and explain the optimal solution.');
    } else {
      onAsk('Provide a structured answer to the latest question or key topic discussed.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  const placeholderText = hasVisualContext
    ? 'Ask AI about this screen, code, stack trace, or problem… (Enter)'
    : 'Ask AI anything or paste a question… (Enter)';

  return (
    <div className="ask-ai-container">
      <form onSubmit={handleSubmit} className="ask-ai-form">
        <div className="ask-ai-input-wrap">
          <span className="ask-ai-search-icon" aria-hidden="true">
            {hasVisualContext ? '👁️' : '✦'}
          </span>
          <input
            ref={inputRef}
            type="text"
            className={`ask-ai-input ${hasVisualContext ? 'ask-ai-input--vision' : ''}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholderText}
            disabled={isGenerating}
            maxLength={300}
            aria-label="Ask AI question input"
          />
          {query.trim() && (
            <button
              type="button"
              className="ask-ai-clear-btn"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear input"
            >
              ×
            </button>
          )}
        </div>

        <button
          type="submit"
          className="ask-ai-submit-btn"
          disabled={isGenerating}
          aria-label="Ask AI"
          title={query.trim() ? "Submit question to Gemini" : hasVisualContext ? "Analyze active screen with Gemini Vision" : "Answer latest topic with Gemini"}
        >
          {isGenerating ? (
            <span className="spinner-icon" />
          ) : (
            <>
              <span>Ask AI</span>
              <kbd className="kbd-shortcut">↵</kbd>
            </>
          )}
        </button>
      </form>

      {/* ── Sub-bar: Auto-answer switch & prompt guidance ── */}
      <div className="ask-ai-meta">
        <label className="auto-answer-toggle" title="Automatically answers interview/meeting questions detected in speech">
          <input
            type="checkbox"
            checked={autoAnswer}
            onChange={(e) => onToggleAutoAnswer(e.target.checked)}
          />
          <span className="toggle-slider" />
          <span className="toggle-label">Auto-answer speech questions</span>
        </label>
      </div>
    </div>
  );
}

