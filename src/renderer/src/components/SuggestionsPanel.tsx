import type { SuggestionItem } from '@shared/types';

interface Props {
  suggestions: SuggestionItem[];
}

const TYPE_CONFIG: Record<
  SuggestionItem['type'],
  { label: string; icon: string; className: string }
> = {
  answer_tip: {
    label: 'STAR Tip',
    icon: '⭐',
    className: 'badge--tip',
  },
  action_item: {
    label: 'Action Item',
    icon: '📝',
    className: 'badge--action',
  },
  key_point: {
    label: 'Key Point',
    icon: '💡',
    className: 'badge--point',
  },
  follow_up: {
    label: 'Follow Up',
    icon: '🔍',
    className: 'badge--followup',
  },
};

export function SuggestionsPanel({ suggestions }: Props) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="suggestions-panel" aria-label="AI Suggestions">
      <div className="section-label">
        <span>AI Copilot Suggestions</span>
        <span className="section-label__count">{suggestions.length}</span>
      </div>

      <div className="suggestions-list" role="feed" aria-label="Live Suggestions">
        {suggestions.map((item) => {
          const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.answer_tip;
          return (
            <div key={item.id} className="suggestion-card">
              <div className="suggestion-header">
                <span className={`suggestion-badge ${config.className}`}>
                  <span className="suggestion-badge__icon">{config.icon}</span>
                  {config.label}
                </span>
                <span className="suggestion-title">{item.title}</span>
              </div>
              <p className="suggestion-content">{item.content}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

