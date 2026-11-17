import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PANEL_MAX, PANEL_MIN } from '@shared/settings';
import type { AnswerAction, AnswerFormat, LibraryItem, SessionMode, SourceKind, SuggestionItem } from '@shared/types';
import { useAssistant } from './state/useAssistant';
import { AnswerPanel } from './components/AnswerPanel';
import { AskBar } from './components/AskBar';
import { HistoryPanel } from './components/HistoryPanel';
import { Icon } from './components/Icon';
import type { IconName } from './components/Icon';
import { InsightsPanel } from './components/InsightsPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { ScreenContext } from './components/ScreenContext';
import { SessionBar } from './components/SessionBar';
import { SettingsDialog } from './components/SettingsDialog';
import type { SettingsSection } from './components/SettingsDialog';
import { Splitter } from './components/Splitter';
import { TitleBar } from './components/TitleBar';
import { TranscriptPanel } from './components/TranscriptPanel';

const winApi = (window as { api?: typeof window.api }).api ?? null;

type CompactTab = 'answer' | 'transcript' | 'context' | 'library' | 'history';
type LeftTab = 'live' | 'history';
type RightTab = 'insights' | 'screen' | 'library';

const COMPACT_TABS: Array<{ id: CompactTab; label: string; icon: IconName }> = [
  { id: 'answer', label: 'Answer', icon: 'sparkles' },
  { id: 'transcript', label: 'Transcript', icon: 'transcript' },
  { id: 'context', label: 'Context', icon: 'screen' },
  { id: 'library', label: 'Library', icon: 'book' },
  { id: 'history', label: 'History', icon: 'history' },
];

function Tabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: Array<{ id: T; label: string; icon?: IconName }>; value: T; onChange: (v: T) => void }) {
  const onKeyDown = (e: { key: string; preventDefault(): void }): void => {
    const i = tabs.findIndex((t) => t.id === value);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : undefined;
    if (next) {
      e.preventDefault();
      onChange(next.id);
    }
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} className="tab" onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={14} />}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const a = useAssistant();
  const { snapshot, prefs } = a;
  const mode = prefs.audio.defaultMode;
  const source = prefs.audio.defaultSource;
  const expanded = a.windowMode === 'expanded';
  const isRunning = snapshot.status === 'active';

  const [draft, setDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>('general');
  const [compactTab, setCompactTab] = useState<CompactTab>('answer');
  const [leftTab, setLeftTab] = useState<LeftTab>('live');
  const [rightTab, setRightTab] = useState<RightTab>('insights');
  const [leftWidth, setLeftWidth] = useState(prefs.layout.leftWidth);
  const [rightWidth, setRightWidth] = useState(prefs.layout.rightWidth);
  const askRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setLeftWidth(prefs.layout.leftWidth), [prefs.layout.leftWidth]);
  useEffect(() => setRightWidth(prefs.layout.rightWidth), [prefs.layout.rightWidth]);

  // ── Theme, accent, text scale, motion ────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const hc = window.matchMedia('(forced-colors: active), (prefers-contrast: more)');
    const apply = (): void => {
      const t = prefs.appearance.theme;
      root.dataset.theme = t === 'system' ? (hc.matches ? 'high-contrast' : mq.matches ? 'light' : 'dark') : t;
      root.dataset.accent = prefs.appearance.accent;
      root.dataset.motion = prefs.appearance.reducedMotion;
      root.style.setProperty('--text-scale', String(prefs.appearance.textScale));
    };
    apply();
    mq.addEventListener('change', apply);
    hc.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      hc.removeEventListener('change', apply);
    };
  }, [prefs.appearance]);

  const focusAsk = useCallback(() => {
    setCompactTab('answer');
    requestAnimationFrame(() => askRef.current?.focus());
  }, []);

  const openSettings = useCallback((s: SettingsSection = 'general') => {
    setSection(s);
    setSettingsOpen(true);
  }, []);

  const toggleSession = useCallback(() => {
    if (snapshot.status === 'idle') void a.start(mode, source);
    else if (snapshot.status === 'active') void a.stop();
  }, [a.start, a.stop, mode, snapshot.status, source]);

  const toggleGhost = useCallback(() => {
    void a.setGhost(!(a.ghost?.state === 'active'));
  }, [a.setGhost, a.ghost?.state]);

  const toggleWindow = useCallback(() => void a.setWindowMode(expanded ? 'compact' : 'expanded'), [a.setWindowMode, expanded]);

  // ── In-window keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && key === 'k') {
        e.preventDefault();
        focusAsk();
      } else if (mod && !e.shiftKey && key === 'e') {
        e.preventDefault();
        toggleWindow();
      } else if (mod && key === ',') {
        e.preventDefault();
        openSettings();
      } else if (mod && e.shiftKey && key === 'r') {
        e.preventDefault();
        toggleSession();
      } else if (mod && e.shiftKey && key === 'h') {
        e.preventDefault();
        toggleGhost();
      } else if (e.key === 'Escape' && !settingsOpen && a.isGenerating) {
        a.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [a.cancel, a.isGenerating, focusAsk, openSettings, settingsOpen, toggleGhost, toggleSession, toggleWindow]);

  // ── Global shortcuts relayed from the main process ───────────────────────
  useEffect(() => {
    if (!a.shortcut) return;
    if (a.shortcut.action === 'quick-ask') focusAsk();
    else {
      setCompactTab('context');
      setRightTab('screen');
      void a.captureScreen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.shortcut]);

  // Success/info notices clear themselves; errors stay until dismissed.
  useEffect(() => {
    if (!a.notice || a.notice.kind === 'error') return;
    const timer = setTimeout(a.dismissNotice, 6000);
    return () => clearTimeout(timer);
  }, [a.notice, a.dismissNotice]);

  const onAsk = useCallback(
    (question: string) => {
      setCompactTab('answer');
      void a.ask(question);
    },
    [a.ask],
  );
  const onAction = useCallback((answer: SuggestionItem, action: AnswerAction) => void a.reviseAnswer(answer, action), [a.reviseAnswer]);
  const onFormat = useCallback(
    (format: AnswerFormat) => {
      void a.updatePrefs({ ai: { answerFormat: format } });
      // "Change format": re-ask the current question in the new format.
      if (a.activeAnswer && a.activeAnswer.source !== 'heuristic' && !a.activeAnswer.tool) void a.reviseAnswer(a.activeAnswer, 'regenerate', format);
    },
    [a.activeAnswer, a.reviseAnswer, a.updatePrefs],
  );
  const onSaveAnswer = useCallback(
    (answer: SuggestionItem) => {
      const sessionId = a.history.some((h) => h.id === answer.sessionId) ? answer.sessionId : null;
      void a.saveToLibrary({ kind: 'answer', title: answer.title, content: answer.content, question: answer.question ?? null, sessionId });
    },
    [a.history, a.saveToLibrary],
  );
  const onQuickCapture = useCallback(
    (text: string) => {
      void a.saveToLibrary({ kind: 'note', title: '', content: text, sessionId: snapshot.activeSession?.id ?? null }).then((saved) => {
        if (saved) a.notify('success', 'Saved to your library as a note.');
      });
    },
    [a.notify, a.saveToLibrary, snapshot.activeSession?.id],
  );
  const onOpenLibraryItem = useCallback(
    (item: LibraryItem) => {
      a.selectAnswer({ id: `lib_${item.id}`, sessionId: item.sessionId ?? 'library', createdAt: item.updatedAt, type: 'key_point', title: item.title, content: item.content, source: 'test', ...(item.question ? { question: item.question } : {}) });
      setCompactTab('answer');
    },
    [a.selectAnswer],
  );
  const onUsePrompt = useCallback(
    (text: string) => {
      setDraft(text);
      focusAsk();
    },
    [focusAsk],
  );
  const onSelectAnswer = useCallback(
    (answer: SuggestionItem) => {
      a.selectAnswer(answer);
      setCompactTab('answer');
    },
    [a.selectAnswer],
  );
  const onRunTool = useCallback(
    (tool: Parameters<typeof a.runTool>[0], input?: string) => {
      setCompactTab('answer');
      void a.runTool(tool, input);
    },
    [a.runTool],
  );

  const finalLines = useMemo(() => a.liveSegments.filter((s) => s.isFinal).length, [a.liveSegments]);
  const profileName = useMemo(() => a.library.find((i) => i.id === prefs.ai.activeProfileId)?.title ?? null, [a.library, prefs.ai.activeProfileId]);
  const cloudShots = prefs.privacy.allowCloudAi && prefs.privacy.allowCloudScreenshots;

  const answerPanel = (
    <AnswerPanel
      answer={a.activeAnswer}
      streaming={a.streaming}
      format={prefs.ai.answerFormat}
      speakingTargetSec={prefs.ai.speakingTargetSec}
      saved={a.activeAnswer ? a.isSaved(a.activeAnswer) : false}
      hasKey={Boolean(a.settings?.hasGeminiKey)}
      onFormat={onFormat}
      onSpeakingTarget={(s) => void a.updatePrefs({ ai: { speakingTargetSec: s } })}
      onAction={onAction}
      onSave={onSaveAnswer}
      onFollowUp={onAsk}
      onCancel={a.cancel}
      onDismiss={() => a.selectAnswer(null)}
      onOpenSettings={() => openSettings('ai')}
    />
  );
  const askBar = (
    <AskBar
      ref={askRef}
      value={draft}
      onChange={setDraft}
      onAsk={onAsk}
      onCancel={a.cancel}
      isGenerating={a.isGenerating}
      autoAnswer={prefs.ai.autoAnswer}
      onToggleAutoAnswer={(v) => void a.updatePrefs({ ai: { autoAnswer: v } })}
      screenAttached={Boolean(a.activeScreenshot) && cloudShots}
      onRemoveScreen={() => void a.clearScreenContext()}
      transcriptLines={Math.min(12, finalLines)}
      profileName={profileName}
      onQuickCapture={onQuickCapture}
    />
  );
  const transcript = <TranscriptPanel segments={a.liveSegments} live={isRunning} onAsk={onAsk} onClear={a.clearLiveSegments} title="Live transcript" />;
  const history = (
    <HistoryPanel
      history={a.history}
      viewing={a.viewing}
      activeSessionId={snapshot.activeSession?.id ?? null}
      onView={(id) => void a.view(id)}
      onCloseView={a.closeView}
      onDelete={(id) => void a.remove(id)}
      onClearAll={() => void a.clearAll()}
      onExport={(id, format) => void a.exportSession(id, format)}
      onSearch={a.searchHistory}
      onSelectAnswer={onSelectAnswer}
    />
  );
  const insights = (
    <InsightsPanel mode={snapshot.activeSession?.mode ?? mode} snapshot={snapshot} answers={a.answers} activeId={a.activeAnswer?.id ?? null} busy={a.isGenerating} finalLines={finalLines} onRunTool={onRunTool} onSelect={onSelectAnswer} />
  );
  const screen = (
    <ScreenContext
      sources={a.screenSources}
      selectedSourceId={a.selectedSourceId}
      onSelectSource={a.setSelectedSourceId}
      onRefreshSources={() => void a.loadScreenSources()}
      pending={a.pendingScreenshot}
      active={a.activeScreenshot}
      capturing={a.isCapturingScreen}
      cloudAllowed={cloudShots}
      onCapture={() => void a.captureScreen()}
      onConfirm={() => void a.confirmScreenshot()}
      onDiscard={() => void a.discardScreenshot()}
      onClear={() => void a.clearScreenContext()}
      onAnalyze={(q) => {
        setCompactTab('answer');
        void a.analyzeScreen(q);
      }}
    />
  );
  const library = (
    <LibraryPanel
      items={a.library}
      activeProfileId={prefs.ai.activeProfileId}
      onSave={a.saveToLibrary}
      onDelete={(id) => void a.deleteFromLibrary(id)}
      onOpen={onOpenLibraryItem}
      onUsePrompt={onUsePrompt}
      onSetProfile={(id) => void a.updatePrefs({ ai: { activeProfileId: id } })}
    />
  );

  const { leftCollapsed, rightCollapsed } = prefs.layout;

  return (
    <div className={`app app--${expanded ? 'expanded' : 'compact'}`} data-ready={a.ready}>
      <TitleBar
        ghost={a.ghost}
        onToggleGhost={toggleGhost}
        windowMode={a.windowMode}
        onToggleWindowMode={toggleWindow}
        onOpenSettings={() => openSettings()}
        onMinimize={() => winApi?.window.minimize()}
        onClose={() => winApi?.window.close()}
      />
      <SessionBar
        snapshot={snapshot}
        mode={mode}
        source={source}
        micLabel={a.micLabel}
        onMode={(m: SessionMode) => void a.updatePrefs({ audio: { defaultMode: m } })}
        onSource={(s: SourceKind) => void a.updatePrefs({ audio: { defaultSource: s } })}
        onStart={toggleSession}
        onStop={toggleSession}
        onPause={(paused) => void a.setPaused(paused)}
      />

      {a.notice && (
        <div className={`notice notice--${a.notice.kind}`} role={a.notice.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={a.notice.kind === 'error' ? 'alert' : a.notice.kind === 'success' ? 'check' : 'info'} size={15} />
          <span className="notice__text">
            <span className="sr-only">{a.notice.kind === 'error' ? 'Error: ' : ''}</span>
            {a.notice.text}
          </span>
          <button type="button" className="icon-btn icon-btn--sm" onClick={a.dismissNotice} aria-label="Dismiss message">
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      {expanded ? (
        <div className="workspace">
          {leftCollapsed ? (
            <div className="rail">
              <button type="button" className="icon-btn" onClick={() => void a.updatePrefs({ layout: { leftCollapsed: false } })} aria-label="Show transcript panel" title="Show transcript panel">
                <Icon name="panelLeft" />
              </button>
            </div>
          ) : (
            <>
              <aside className="side" style={{ width: leftWidth }} aria-label="Transcript and history">
                <div className="side__tabs">
                  <Tabs label="Left panel" value={leftTab} onChange={setLeftTab} tabs={[{ id: 'live', label: 'Live', icon: 'transcript' }, { id: 'history', label: 'History', icon: 'history' }]} />
                  <button type="button" className="icon-btn icon-btn--sm" onClick={() => void a.updatePrefs({ layout: { leftCollapsed: true } })} aria-label="Hide transcript panel" title="Hide panel">
                    <Icon name="chevronLeft" size={14} />
                  </button>
                </div>
                <div className="side__body" role="tabpanel">
                  {leftTab === 'live' ? transcript : history}
                </div>
              </aside>
              <Splitter label="Resize transcript panel" value={leftWidth} min={PANEL_MIN} max={PANEL_MAX} direction={1} onChange={setLeftWidth} onCommit={(v) => void a.updatePrefs({ layout: { leftWidth: v } })} />
            </>
          )}

          <main className="centre">
            {answerPanel}
            {askBar}
          </main>

          {rightCollapsed ? (
            <div className="rail">
              <button type="button" className="icon-btn" onClick={() => void a.updatePrefs({ layout: { rightCollapsed: false } })} aria-label="Show insights panel" title="Show insights panel">
                <Icon name="panelRight" />
              </button>
            </div>
          ) : (
            <>
              <Splitter label="Resize insights panel" value={rightWidth} min={PANEL_MIN} max={PANEL_MAX} direction={-1} onChange={setRightWidth} onCommit={(v) => void a.updatePrefs({ layout: { rightWidth: v } })} />
              <aside className="side" style={{ width: rightWidth }} aria-label="Insights, screen context and library">
                <div className="side__tabs">
                  <button type="button" className="icon-btn icon-btn--sm" onClick={() => void a.updatePrefs({ layout: { rightCollapsed: true } })} aria-label="Hide insights panel" title="Hide panel">
                    <Icon name="chevronRight" size={14} />
                  </button>
                  <Tabs label="Right panel" value={rightTab} onChange={setRightTab} tabs={[{ id: 'insights', label: 'Insights', icon: 'sparkles' }, { id: 'screen', label: 'Screen', icon: 'screen' }, { id: 'library', label: 'Library', icon: 'book' }]} />
                </div>
                <div className="side__body" role="tabpanel">
                  {rightTab === 'insights' ? insights : rightTab === 'screen' ? screen : library}
                </div>
              </aside>
            </>
          )}
        </div>
      ) : (
        <>
          <main className="compact" role="tabpanel">
            {compactTab === 'answer' && (
              <>
                {answerPanel}
                {askBar}
              </>
            )}
            {compactTab === 'transcript' && transcript}
            {compactTab === 'context' && (
              <div className="compact__scroll">
                {screen}
                {insights}
              </div>
            )}
            {compactTab === 'library' && library}
            {compactTab === 'history' && history}
          </main>
          <nav className="bottomnav">
            <Tabs label="Views" value={compactTab} onChange={setCompactTab} tabs={COMPACT_TABS} />
          </nav>
        </>
      )}

      {/* One polite live region for status changes. Streamed answer text is never announced. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {a.announcement}
      </div>

      <SettingsDialog
        open={settingsOpen}
        section={section}
        onSection={setSection}
        onClose={() => setSettingsOpen(false)}
        settings={a.settings}
        prefs={prefs}
        ghost={a.ghost}
        micDevices={a.micDevices}
        sessionActive={snapshot.status !== 'idle'}
        onSave={a.saveSettings}
        onPrefs={(patch) => void a.updatePrefs(patch)}
        onGhost={(v) => void a.setGhost(v)}
        onRefreshMics={() => void a.refreshMicDevices()}
        onTestGemini={a.testGemini}
        onBackup={() => void a.backup()}
        onWipe={() => void a.wipeData()}
        onAlwaysOnTop={(v) => {
          void a.updatePrefs({ layout: { alwaysOnTop: v } });
          void winApi?.window.setAlwaysOnTop(v);
        }}
      />
    </div>
  );
}
