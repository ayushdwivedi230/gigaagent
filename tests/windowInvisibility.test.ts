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
} from '../src/main/services/windowInvisibilityService';

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
  const service = new WindowInvisibilityService();

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
  const service = new WindowInvisibilityService();
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
  mockWin.emit('move');
  assert.equal(calls.length, 4);
  assert.equal(calls[3], true);

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
  const service = new WindowInvisibilityService();
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

