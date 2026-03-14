import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalnetTicTacToeEngine, constants } from '../src/localnet-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..', '..', '..');

test('full localnet user journey: ttt + invite + timeout', async () => {
  const engine = await LocalnetTicTacToeEngine.create(projectRoot);

  const setup = await engine.initGame(2);
  assert.equal(setup.every((s) => s.ok), true);

  // Open TTT game
  assert.equal((await engine.createOpen()).ok, true);
  assert.equal((await engine.join('p2')).ok, true);
  assert.equal((await engine.playTTT('p1', 0, 0)).ok, true);
  assert.equal((await engine.playTTT('p2', 1, 0)).ok, true);
  assert.equal((await engine.playTTT('p1', 0, 1)).ok, true);
  assert.equal((await engine.playTTT('p2', 1, 1)).ok, true);
  assert.equal((await engine.playTTT('p1', 0, 2)).ok, true);

  let state = engine.getState();
  assert.equal(state.match.status, constants.MATCH_P1_WIN);
  // Invite flow + rejection
  assert.equal((await engine.createInvite()).ok, true);
  const wrongJoin = await engine.join('p3');
  assert.equal(wrongJoin.ok, false);
  assert.equal((await engine.join('p2')).ok, true);

  // Timeout flow
  assert.equal((await engine.playTTT('p1', 2, 2)).ok, true);
  await engine.waitForTimeoutWindow();
  const timeoutClaim = await engine.claimTimeout('p1');
  assert.equal(timeoutClaim.ok, true);

  state = engine.getState();
  assert.equal(state.match.status, constants.MATCH_P1_WIN);
});
