import type { AppError, RawSegment } from '@shared/types';
import type { TranscriptSource } from './transcriptSource';

const SCRIPT = [
  '[Demo] Welcome. To start, could you walk me through your background in a couple of minutes?',
  '[Demo] Tell me about a project where you had to learn a new tool quickly.',
  '[Demo] What was the hardest trade-off you made, and how did you decide?',
  '[Demo] How do you handle feedback that you disagree with?',
  '[Demo] Last question: where do you want to grow over the next year?',
];

const WORDS_PER_TICK = 3;

export interface DemoPacing {
  tickMs: number;
  pauseMs: number;
  firstLineDelayMs: number;
}

const DEFAULT_PACING: DemoPacing = { tickMs: 450, pauseMs: 1600, firstLineDelayMs: 800 };

/**
 * Placeholder source for milestone 1. It emits interim then final segments on a timer
 * so the UI and the interim->final merge logic can be exercised. It captures NO audio.
 */
export class DemoTranscriptSource implements TranscriptSource {
  readonly kind = 'demo' as const;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private startedAt = 0;
  private line = 0;
  private emit: ((segment: RawSegment) => void) | undefined;
  private readonly clock: () => number;
  private readonly pacing: DemoPacing;

  constructor(pacing: Partial<DemoPacing> = {}, clock: () => number = Date.now) {
    this.pacing = { ...DEFAULT_PACING, ...pacing };
    this.clock = clock;
  }

  start(onSegment: (segment: RawSegment) => void, _onError: (error: AppError) => void): Promise<void> {
    this.running = true;
    this.startedAt = this.clock();
    this.line = 0;
    this.emit = onSegment;
    this.schedule(() => this.speak(), this.pacing.firstLineDelayMs);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.running = false;
    this.emit = undefined;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    return Promise.resolve();
  }

  private elapsed(): number {
    return Math.max(0, this.clock() - this.startedAt);
  }

  private schedule(fn: () => void, ms: number): void {
    this.timer = setTimeout(fn, ms);
  }

  private speak(): void {
    if (!this.running) return;
    const text = SCRIPT[this.line % SCRIPT.length] ?? '';
    this.reveal(`demo-${this.line}`, text.split(' '), 0, this.elapsed());
  }

  private reveal(id: string, words: string[], shown: number, startMs: number): void {
    if (!this.running) return;
    const count = Math.min(words.length, shown + WORDS_PER_TICK);
    const isFinal = count === words.length;
    this.emit?.({
      id,
      text: words.slice(0, count).join(' '),
      isFinal,
      startMs,
      endMs: isFinal ? this.elapsed() : null,
    });
    if (isFinal) {
      this.line += 1;
      this.schedule(() => this.speak(), this.pacing.pauseMs);
    } else {
      this.schedule(() => this.reveal(id, words, count, startMs), this.pacing.tickMs);
    }
  }
}
