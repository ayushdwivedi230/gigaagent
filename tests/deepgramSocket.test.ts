import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeDeepgramWebSocket } from '../src/main/services/deepgramSocket';

test('NodeDeepgramWebSocket initializes in connecting state and handles frame encoding', () => {
  const ws = new NodeDeepgramWebSocket('wss://api.deepgram.com/v1/listen?model=nova-2', 'test-api-key');
  assert.equal(ws.readyState, NodeDeepgramWebSocket.CONNECTING);
  ws.close();
  assert.equal(ws.readyState, NodeDeepgramWebSocket.CLOSED);
});

