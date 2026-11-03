import { useState } from 'react';
import type { SessionMode, SourceKind } from '@shared/types';
import { useAssistant } from './state/useAssistant';
import { useElapsed } from './state/useElapsed';
import { Header } from './components/Header';
import { AudioBar } from './components/AudioBar';
import { AnswerCard } from './components/AnswerCard';
import { AskAiInput } from './components/AskAiInput';
import { TranscriptPanel } from './components/TranscriptPanel';
import { SettingsModal } from './components/SettingsModal';

const winApi = (window as { api?: typeof window.api }).api ?? null;

export default function App() {
  const assistant = useAssistant();
  const { snapshot } = assistant;
  const active = snapshot.activeSession;
  const inSession = snapshot.status !== 'active' && snapshot.status !== 'idle';
  const isRunning = snapshot.status === 'active';
  const isTransitioning = snapshot.status === 'starting' || snapshot.status === 'stopping';
  const elapsedMs = useElapsed(active?.startedAt ?? null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<SessionMode>('mock-interview');
  const [source, setSource] = useState<SourceKind>('both');

  const handleToggleSession = () => {
    if (snapshot.status === 'idle') {
      void assistant.start(mode, '', source);
    } else if (isRunning) {
      void assistant.stop();
    }
  };

  const handleAskQuestion = (question: string) => {
    void assistant.askAi(question, {
      mode,
    });
  };

  const handleRegenerate = (question: string) => {
    void assistant.askAi(question, {
      mode,
    });
  };

  return (
    <div className="copilot-app">
      {/* ── Top Header ── */}
      <Header
        mode={mode}
        onSelectMode={(m) => setMode(m)}
        disabledModes={isRunning}
        onOpenSettings={() => setSettingsOpen(true)}
        onMinimize={() => winApi?.window.minimize()}
        onClose={() => winApi?.window.close()}
      />

      {/* ── Actionable Notification / Error Alert ── */}
      {assistant.error && (
        <div className="copilot-alert" role="alert">
          <span className="copilot-alert__icon" aria-hidden="true">
            ⚠️
          </span>
          <span className="copilot-alert__text">{assistant.error}</span>
          <button
            type="button"
            className="copilot-alert__close"
            onClick={assistant.dismissError}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Compact Audio & Session Control Bar ── */}
      <AudioBar
        source={source}
        onSelectSource={(s) => setSource(s)}
        isRunning={isRunning}
        isTransitioning={isTransitioning}
        onToggleSession={handleToggleSession}
        elapsedMs={elapsedMs}
      />

      {/* ── Main AI Answer Panel (Highest Visual Priority) ── */}
      <main className="copilot-main">
        <AnswerCard
          answer={assistant.activeAnswer}
          isGenerating={assistant.isGeneratingAnswer}
          onRegenerate={handleRegenerate}
          onClear={assistant.clearAnswer}
        />

        {/* ── One-Click Ask AI Bar ── */}
        <AskAiInput
          onAsk={handleAskQuestion}
          isGenerating={assistant.isGeneratingAnswer}
          autoAnswer={assistant.autoAnswer}
          onToggleAutoAnswer={assistant.setAutoAnswer}
        />

        {/* ── Separate Transcript Log ── */}
        <TranscriptPanel
          segments={assistant.liveSegments}
          isRunning={isRunning}
          onAskAboutSegment={handleAskQuestion}
          onClear={assistant.clearLiveSegments}
        />
      </main>

      {/* ── Settings Modal ── */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={assistant.settings}
        onSave={assistant.saveSettings}
      />
    </div>
  );
}
