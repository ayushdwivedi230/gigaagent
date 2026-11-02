import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemAudioGate } from '../src/main/services/systemAudioGate';
import type { BrowserWindow } from 'electron';

test('SystemAudioGate: arm and disarm lifecycle', async () => {
  const gate = new SystemAudioGate(100); // 100ms timeout for test
  assert.equal(gate.isArmed(), false);

  gate.arm();
  assert.equal(gate.isArmed(), true);

  gate.disarm();
  assert.equal(gate.isArmed(), false);

  // Auto-disarm on timeout
  gate.arm();
  assert.equal(gate.isArmed(), true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(gate.isArmed(), false);
});

test('SystemAudioGate: validates frame, security origin, user gesture, and media constraints', () => {
  const gate = new SystemAudioGate();

  const mockMainFrame = { id: 1 };
  const mockWin = {
    isDestroyed: () => false,
    webContents: {
      mainFrame: mockMainFrame,
    },
  } as unknown as BrowserWindow;

  // 1. Rejected if gate is not armed
  const resDisarmed = gate.validateRequest(
    {
      frame: { top: mockMainFrame },
      securityOrigin: 'http://localhost:5173',
      userGesture: true,
      videoRequested: true,
      audioRequested: true,
    },
    mockWin,
  );
  assert.equal(resDisarmed.valid, false);
  assert.match(resDisarmed.reason, /disarmed/i);

  // Arm the gate
  gate.arm();

  // 2. Rejected if frame does not match main window top frame
  const resBadFrame = gate.validateRequest(
    {
      frame: { top: { id: 999 } }, // different frame
      securityOrigin: 'http://localhost:5173',
      userGesture: true,
      videoRequested: true,
      audioRequested: true,
    },
    mockWin,
  );
  assert.equal(resBadFrame.valid, false);
  assert.match(resBadFrame.reason, /frame/i);

  // 3. Rejected if untrusted origin
  const resBadOrigin = gate.validateRequest(
    {
      frame: { top: mockMainFrame },
      securityOrigin: 'https://malicious-attacker.com',
      userGesture: true,
      videoRequested: true,
      audioRequested: true,
    },
    mockWin,
  );
  assert.equal(resBadOrigin.valid, false);
  assert.match(resBadOrigin.reason, /origin/i);

  // 4. Rejected if user gesture is absent
  const resNoGesture = gate.validateRequest(
    {
      frame: { top: mockMainFrame },
      securityOrigin: 'file:///app/index.html',
      userGesture: false,
      videoRequested: true,
      audioRequested: true,
    },
    mockWin,
  );
  assert.equal(resNoGesture.valid, false);
  assert.match(resNoGesture.reason, /gesture/i);

  // 5. Rejected if audioRequested is missing
  const resNoAudio = gate.validateRequest(
    {
      frame: { top: mockMainFrame },
      securityOrigin: 'file:///app/index.html',
      userGesture: true,
      videoRequested: true,
      audioRequested: false,
    },
    mockWin,
  );
  assert.equal(resNoAudio.valid, false);
  assert.match(resNoAudio.reason, /both video and audio/i);

  // 6. Valid request succeeds and immediately disarms the gate
  const resValid = gate.validateRequest(
    {
      frame: { top: mockMainFrame },
      securityOrigin: 'file:///app/index.html',
      userGesture: true,
      videoRequested: true,
      audioRequested: true,
    },
    mockWin,
  );
  assert.equal(resValid.valid, true);
  // Must be disarmed after success to prevent replay
  assert.equal(gate.isArmed(), false);
});

