import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalnetTicTacToeEngine } from '../src/localnet-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..', '..', '..');

function hasLocalnet(): boolean {
  return process.env.FIVE_RPC_URL === 'http://127.0.0.1:8899' || !process.env.FIVE_RPC_URL;
}

test('engine create returns valid addresses on localnet', async (t) => {
  if (!hasLocalnet()) {
    t.skip('localnet-only test');
    return;
  }

  const engine = await LocalnetTicTacToeEngine.create(projectRoot);
  const addresses = engine.getAddresses();

  assert.equal(typeof addresses.scriptAccount, 'string');
  assert.ok(addresses.scriptAccount.length > 20);
  assert.ok(addresses.p1.length > 20);
  assert.ok(addresses.p2.length > 20);
  assert.notEqual(addresses.p1, addresses.p2);
});
