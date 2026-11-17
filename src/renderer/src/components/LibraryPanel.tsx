import { memo, useMemo, useState } from 'react';
import type { LibraryItem, LibraryKind, SaveLibraryItemRequest } from '@shared/types';
import { ConfirmDialog } from './Dialog';
import { Icon } from './Icon';
import type { IconName } from './Icon';

interface LibraryPanelProps {
  items: LibraryItem[];
  activeProfileId: string | null;
  onSave: (item: SaveLibraryItemRequest) => Promise<unknown>;
  onDelete: (id: string) => void;
  onOpen: (item: LibraryItem) => void;
  onUsePrompt: (text: string) => void;
  onSetProfile: (id: string | null) => void;
}

const KINDS: Array<{ kind: LibraryKind; label: string; plural: string; icon: IconName; hint: string }> = [
  { kind: 'answer', label: 'Answer', plural: 'Answers', icon: 'bookmark', hint: 'Saved AI answers' },
  { kind: 'note', label: 'Note', plural: 'Notes', icon: 'note', hint: 'Quick-capture notes' },
  { kind: 'prompt', label: 'Prompt', plural: 'Prompts', icon: 'wand', hint: 'Reusable question templates' },
  { kind: 'profile', label: 'Profile', plural: 'Profiles', icon: 'user', hint: 'Role, company and résumé notes used as preparation context' },
];

interface Draft {
  id?: string;
  kind: LibraryKind;
  title: string;
  content: string;
  tags: string;
}

/** Local library: saved answers, notes, prompt templates and preparation profiles. */
export const LibraryPanel = memo(function LibraryPanel({ items, activeProfileId, onSave, onDelete, onOpen, onUsePrompt, onSetProfile }: LibraryPanelProps) {
  const [filter, setFilter] = useState<LibraryKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<LibraryItem | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => (filter === 'all' || i.kind === filter) && (!q || `${i.title}\n${i.content}\n${i.tags.join(' ')}`.toLowerCase().includes(q)));
  }, [items, filter, query]);

  const save = async (): Promise<void> => {
    if (!draft || !draft.content.trim()) return;
    const request: SaveLibraryItemRequest = {
      kind: draft.kind,
      title: draft.title,
      content: draft.content,
      tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
    };
    if (draft.id) request.id = draft.id;
    await onSave(request);
    setDraft(null);
  };

  if (draft) {
    const meta = KINDS.find((k) => k.kind === draft.kind)!;
    return (
      <section className="panel library" aria-label="Library editor">
        <header className="panel__head">
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => setDraft(null)} aria-label="Back to library">
            <Icon name="chevronLeft" size={14} />
          </button>
          <h2 className="panel__title">{draft.id ? `Edit ${meta.label.toLowerCase()}` : `New ${meta.label.toLowerCase()}`}</h2>
        </header>
        <form
          className="panel__body form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span className="field__label">Title</span>
            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={160} placeholder={draft.kind === 'profile' ? 'e.g. QA Engineer — Acme' : 'Optional'} />
          </label>
          <label className="field">
            <span className="field__label">{draft.kind === 'profile' ? 'Role, company and résumé notes' : draft.kind === 'prompt' ? 'Prompt text' : 'Content'}</span>
            <textarea className="textarea" rows={9} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} maxLength={60000} required data-autofocus />
          </label>
          <label className="field">
            <span className="field__label">Tags (comma separated)</span>
            <input className="input" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
          </label>
          {draft.kind === 'profile' && <p className="muted">When a profile is active its text is sent to Gemini as background with your questions.</p>}
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={!draft.content.trim()}>
              Save
            </button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="panel library" aria-label="Library">
      <header className="panel__head">
        <h2 className="panel__title">Library</h2>
        <span className="panel__count">{items.length}</span>
        <div className="search">
          <Icon name="search" size={13} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search library" />
        </div>
      </header>
      <div className="tabs tabs--scroll" role="tablist" aria-label="Library filter">
        {[{ kind: 'all' as const, plural: 'All' }, ...KINDS].map((k) => (
          <button key={k.kind} type="button" role="tab" aria-selected={filter === k.kind} className="tab" onClick={() => setFilter(k.kind)}>
            {k.plural}
          </button>
        ))}
      </div>
      <div className="panel__body">
        <div className="row row--wrap">
          {KINDS.filter((k) => k.kind !== 'answer').map((k) => (
            <button key={k.kind} type="button" className="btn btn--sm" onClick={() => setDraft({ kind: k.kind, title: '', content: '', tags: '' })} title={k.hint}>
              <Icon name="plus" size={13} />
              {k.label}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <div className="empty empty--sm">
            <div className="empty__art" aria-hidden="true">
              <Icon name="book" size={18} />
            </div>
            <p className="empty__text">{query || filter !== 'all' ? 'Nothing matches.' : 'Save answers, capture notes, and keep prompts and preparation profiles here. Everything stays on this computer.'}</p>
          </div>
        ) : (
          <ul className="cards">
            {visible.map((item) => {
              const meta = KINDS.find((k) => k.kind === item.kind)!;
              const isActiveProfile = item.kind === 'profile' && item.id === activeProfileId;
              return (
                <li key={item.id} className={`libitem${isActiveProfile ? ' libitem--active' : ''}`}>
                  <div className="libitem__head">
                    <span className="card__kind">
                      <Icon name={meta.icon} size={12} />
                      {meta.label}
                      {isActiveProfile && <span className="chip chip--accent">Active</span>}
                    </span>
                    <time className="muted">{new Date(item.updatedAt).toLocaleDateString()}</time>
                  </div>
                  <p className="card__title">{item.title}</p>
                  <p className="card__text">{item.content.replace(/[#*`>|]/g, '').slice(0, 140)}</p>
                  {item.tags.length > 0 && (
                    <ul className="chips">
                      {item.tags.map((t) => (
                        <li key={t} className="chip chip--quiet">
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="row row--wrap">
                    {item.kind === 'prompt' && (
                      <button type="button" className="btn btn--sm btn--primary" onClick={() => onUsePrompt(item.content)}>
                        Use
                      </button>
                    )}
                    {item.kind === 'profile' && (
                      <button type="button" className="btn btn--sm" aria-pressed={isActiveProfile} onClick={() => onSetProfile(isActiveProfile ? null : item.id)}>
                        {isActiveProfile ? 'Deactivate' : 'Set active'}
                      </button>
                    )}
                    {(item.kind === 'answer' || item.kind === 'note') && (
                      <button type="button" className="btn btn--sm" onClick={() => onOpen(item)}>
                        Open
                      </button>
                    )}
                    {item.kind !== 'answer' && (
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setDraft({ id: item.id, kind: item.kind, title: item.title, content: item.content, tags: item.tags.join(', ') })}>
                        Edit
                      </button>
                    )}
                    <button type="button" className="icon-btn icon-btn--sm" onClick={() => setToDelete(item)} aria-label={`Delete ${item.title}`} title="Delete">
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete from library?"
        message={`"${toDelete?.title ?? ''}" will be permanently deleted from this computer.`}
        confirmLabel="Delete"
        onConfirm={() => toDelete && onDelete(toDelete.id)}
        onClose={() => setToDelete(null)}
      />
    </section>
  );
});
