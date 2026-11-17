import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  WindowInvisibilityService,
  WDA_NONE,
  WDA_MONITOR,
  WDA_EXCLUDEFROMCAPTURE,
  NS_WINDOW_SHARING_NONE,
  NS_WINDOW_SHARING_READ_ONLY,
  detectGhostSupport,
} from '../src/main/services/windowInvisibilityService';

// 3.0: capture exclusion is only attempted where the OS supports it, so lifecycle tests pin a
// supported platform instead of depending on the machine that runs the tests.
const WIN_SUPPORT = detectGhostSupport('win32', '10.0.22631');

test('1. Constants: Win32 and macOS affinity flags match specifications', () => {
  assert.equal(WDA_NONE, 0x00000000);
  assert.equal(WDA_MONITOR, 0x00000001);
  assert.equal(WDA_EXCLUDEFROMCAPTURE, 0x00000011); // 17 decimal
  assert.equal(NS_WINDOW_SHARING_NONE, 0);
  assert.equal(NS_WINDOW_SHARING_READ_ONLY, 1);
});

test('2. Initialization: Defaults to enabled with correct platform affinity name', () => {
  const service = new WindowInvisibilityService();
  assert.equal(service.isEnabled(), true);

  const status = service.getStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.platform, process.platform);
  if (process.platform === 'win32') {
    assert.match(status.affinityFlag, /WDA_EXCLUDEFROMCAPTURE/);
  } else if (process.platform === 'darwin') {
    assert.match(status.affinityFlag, /NSWindowSharingNone/);
  }
});

test('3. HWND Parsing: Correctly reads 64-bit and 32-bit native handle buffers', () => {
  const service = new WindowInvisibilityService({ support: WIN_SUPPORT });

  // Mock 64-bit handle buffer (e.g. 0x0000000000123456)
  const buf64 = Buffer.alloc(8);
  buf64.writeBigUInt64LE(BigInt(0x123456), 0);

  const mockWin64 = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setContentProtection: () => {},
    getNativeWindowHandle: () => buf64,
  }) as any;

  service.attach(mockWin64);
  const hwnd64 = service.getHwnd();
  assert.equal(hwnd64, BigInt(0x123456));

  const status = service.getStatus();
  assert.equal(status.hwndHex, '0x123456');

  service.destroy();
});

test('4. Lifecycle & Reassertion: Content protection is called on attach and reasserted on window events', () => {
  const service = new WindowInvisibilityService({ support: WIN_SUPPORT });
  const calls: boolean[] = [];

  const mockWin = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setContentProtection: (val: boolean) => {
      calls.push(val);
    },
    getNativeWindowHandle: () => Buffer.alloc(8),
  }) as any;

  service.attach(mockWin);

  // Immediately applied on attach
  assert.equal(calls.length, 1);
  assert.equal(calls[0], true);

  // Simulate restore event
  mockWin.emit('restore');
  assert.equal(calls.length, 2);
  assert.equal(calls[1], true);

  // Simulate focus event
  mockWin.emit('focus');
  assert.equal(calls.length, 3);
  assert.equal(calls[2], true);

  // Simulate move event
  mockWin.emit('moved');
  assert.equal(calls.length, 4);
  assert.equal(calls[3], true);

  // Simulate blur event (switching to Zoom/Meet)
  mockWin.emit('blur');
  assert.equal(calls.length, 5);
  assert.equal(calls[4], true);

  // Simulate resize / resized events
  mockWin.emit('resize');
  assert.equal(calls.length, 6);
  assert.equal(calls[5], true);

  mockWin.emit('resized');
  assert.equal(calls.length, 7);
  assert.equal(calls[6], true);

  // Toggle off
  service.setEnabled(false);
  assert.equal(service.isEnabled(), false);
  assert.equal(calls[calls.length - 1], false);

  // Toggle back on
  service.setEnabled(true);
  assert.equal(service.isEnabled(), true);
  assert.equal(calls[calls.length - 1], true);

  service.destroy();
});

test('5. Destruction: Cleans up listeners safely when window closes', () => {
  const service = new WindowInvisibilityService({ support: WIN_SUPPORT });
  let calls = 0;

  const mockWin = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setContentProtection: () => { calls++; },
    getNativeWindowHandle: () => Buffer.alloc(8),
  }) as any;

  service.attach(mockWin);
  assert.equal(calls, 1);

  // Close window
  mockWin.emit('closed');

  // Further events must not trigger calls
  mockWin.emit('focus');
  mockWin.emit('restore');
  assert.equal(calls, 1);

  service.destroy();
});


test('6. Platform support: Windows 10 2004+, older Windows, macOS and Linux are described honestly', () => {
  const modern = detectGhostSupport('win32', '10.0.19045');
  assert.equal(modern.supported, true);
  assert.match(modern.mechanism, /WDA_EXCLUDEFROMCAPTURE/);
  const old = detectGhostSupport('win32', '10.0.18363');
  assert.equal(old.supported, true);
  assert.match(old.mechanism, /WDA_MONITOR/);
  assert.match(detectGhostSupport('darwin', '23.0.0').mechanism, /NSWindowSharingNone/);
  const linux = detectGhostSupport('linux', '6.1.0');
  assert.equal(linux.supported, false);
  // The product must never claim to be undetectable.
  for (const s of [modern, old, detectGhostSupport('darwin', '23.0.0')]) {
    assert.match(s.detail, /must not be relied on as undetectable/i);
    assert.match(s.detail, /monitoring or proctoring software/i);
  }
});

test('7. State machine: off -> active -> off, with change notifications', () => {
  const states: string[] = [];
  const calls: boolean[] = [];
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.alloc(0),
    setContentProtection: (v: boolean) => calls.push(v),
  });
  const service = new WindowInvisibilityService({ enabled: false, support: WIN_SUPPORT, onChange: (s) => states.push(String(s.state)) });
  service.attach(win as never);
  assert.equal(service.getStatus().state, 'off');
  assert.equal(service.setEnabled(true).state, 'active');
  assert.equal(service.setEnabled(false).state, 'off');
  assert.deepEqual(calls, [false, true, false]);
  assert.deepEqual(states, ['off', 'active', 'off']);
  // While off, window events must not silently turn protection back on.
  win.emit('focus');
  win.emit('restore');
  assert.deepEqual(calls, [false, true, false]);
});

test('8. Unsupported platform: reports "unsupported" and never calls the OS', () => {
  let calls = 0;
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.alloc(0),
    setContentProtection: () => { calls++; },
  });
  const service = new WindowInvisibilityService({ enabled: true, support: detectGhostSupport('linux', '6.1.0') });
  service.attach(win as never);
  const status = service.setEnabled(true);
  assert.equal(status.state, 'unsupported');
  assert.equal(status.supported, false);
  assert.equal(calls, 0);
});

test('9. Error state: an OS failure is surfaced, not swallowed', () => {
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getNativeWindowHandle: () => Buffer.alloc(0),
    setContentProtection: () => { throw new Error('access denied'); },
  });
  const service = new WindowInvisibilityService({ enabled: true, support: WIN_SUPPORT });
  service.attach(win as never);
  const status = service.getStatus();
  assert.equal(status.state, 'error');
  assert.match(String(status.error), /access denied/);
});

test('10. No child processes: the service never shells out', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/main/services/windowInvisibilityService.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from 'node:child_process'|\bexec\(|\bspawn\(/);
});
