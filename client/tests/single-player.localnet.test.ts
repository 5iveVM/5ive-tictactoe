import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalnetTicTacToeEngine, constants } from '../src/localnet-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..', '..', '..');

test('single-player localnet journey: start + atomic player/cpu turns', async () => {
  const engine = await LocalnetTicTacToeEngine.create(projectRoot);

  await engine.initGame(5);
  assert.equal((await engine.createOpen()).ok, true);
  assert.equal((await engine.startSingle()).ok, true);

  let state = engine.getState();
  assert.equal(state.match.status, constants.MATCH_ACTIVE);
  assert.equal(state.match.currentTurn, constants.TURN_P1);
  assert.equal(state.match.player1, state.match.player2);

  // One atomic move should advance by two marks (player + cpu) unless terminal.
  const m1 = await engine.playTTTSingle(0, 0);
  assert.equal(m1.ok, true);
  state = engine.getState();
  assert.ok(state.match.moveCount === 1 || state.match.moveCount === 2);

  // Continue with legal open squares to ensure flow remains stable.
  for (let turn = 0; turn < 6; turn++) {
    const snapshot = engine.getState();
    if (snapshot.match.status !== constants.MATCH_ACTIVE) break;
    const empty = snapshot.board.findIndex((v) => v === 0);
    if (empty < 0) break;
    const r = Math.floor(empty / 3);
    const c = empty % 3;
    const res = await engine.playTTTSingle(r, c);
    assert.equal(res.ok, true);
  }

  state = engine.getState();
  assert.ok([
    constants.MATCH_ACTIVE,
    constants.MATCH_P1_WIN,
    constants.MATCH_P2_WIN,
    constants.MATCH_DRAW,
  ].includes(state.match.status));

  // Invalid replay on occupied cell should fail locally.
  const replay = await engine.playTTTSingle(0, 0);
  assert.equal(replay.ok, false);
});
