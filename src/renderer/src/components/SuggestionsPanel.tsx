import { useState } from 'react';
import type { SuggestionItem } from '@shared/types';

interface Props {
  suggestions: SuggestionItem[];
  onTestGemini?: () => Promise<unknown> | void;
}

const TYPE_CONFIG: Record<
  SuggestionItem['type'],
  { label: string; icon: string; className: string }
> = {
  answer_tip: {
    label: 'Answer Outline',
    icon: '🎯',
    className: 'badge--tip',
  },
  action_item: {
    label: 'Action Item',
    icon: '📝',
    className: 'badge--action',
  },
  key_point: {
    label: 'Key Concept',
    icon: '💡',
    className: 'badge--point',
  },
  follow_up: {
    label: 'Follow Up',
    icon: '🔍',
    className: 'badge--followup',
  },
};

export function SuggestionsPanel({ suggestions, onTestGemini }: Props) {
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    if (!onTestGemini || isTesting) return;
    setIsTesting(true);
    try {
      await onTestGemini();
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="suggestions-panel" aria-label="AI Suggestions">
      <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span>AI Copilot Suggestions</span>
          {suggestions.length > 0 && (
            <span className="section-label__count">{suggestions.length}</span>
          )}
        </div>
        {onTestGemini && (
          <button
            type="button"
            className="btn-quiet"
            onClick={handleTest}
            disabled={isTesting}
            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}
            title="Submits a test technical question directly to Gemini to verify connectivity"
          >
            {isTesting ? 'Testing…' : '⚡ Test AI'}
          </button>
        )}
      </div>

      {suggestions.length > 0 ? (
        <div className="suggestions-list" role="feed" aria-label="Live Suggestions">
          {suggestions.map((item) => {
            const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.answer_tip;
            const isGemini = item.source === 'gemini';
            const isHeuristic = item.source === 'heuristic';

            return (
              <div key={item.id} className="suggestion-card">
                <div className="suggestion-header" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                  <span className={`suggestion-badge ${config.className}`}>
                    <span className="suggestion-badge__icon">{config.icon}</span>
                    {config.label}
                  </span>

                  {item.source && (
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontWeight: 600,
                        backgroundColor: isGemini ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                        color: isGemini ? '#4ade80' : '#facc15',
                      }}
                    >
                      {isGemini ? '✦ Gemini Live' : isHeuristic ? 'Local Heuristic' : 'Live Test'}
                    </span>
                  )}

                  {item.isQuestion && (
                    <span style={{ fontSize: '10px', opacity: 0.8, color: '#60a5fa' }}>
                      [Q&A Response]
                    </span>
                  )}

                  <span className="suggestion-title" style={{ width: '100%', marginTop: '2px' }}>
                    {item.title}
                  </span>
                </div>
                <p className="suggestion-content">{item.content}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: '12px', opacity: 0.6, padding: '8px 12px', fontStyle: 'italic' }}>
          Listening for discussion questions and prompts to generate real-time AI talking points…
        </div>
      )}
    </div>
  );
}
