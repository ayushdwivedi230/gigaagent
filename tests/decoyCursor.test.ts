import test from 'node:test';
import assert from 'node:assert/strict';
import { DecoyCursorService } from '../src/main/services/decoyCursorService';

test('DecoyCursorService: initializes, toggles and tracks state safely', () => {
  const service = new DecoyCursorService({ enabled: true });
  assert.equal(service.isEnabled(), true);

  // Calling showAt / hide when electron BrowserWindow is mocked or headless
  service.showAt(100, 200);
  service.hide();

  // Disabling service hides decoy
  service.setEnabled(false);
  assert.equal(service.isEnabled(), false);

  // Re-enabling service
  service.setEnabled(true);
  assert.equal(service.isEnabled(), true);

  // Destroying cleans up without error
  service.destroy();
});
