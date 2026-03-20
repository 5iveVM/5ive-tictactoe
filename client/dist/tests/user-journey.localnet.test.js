import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalnetTicTacToeEngine, constants } from '../src/localnet-engine.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..', '..', '..');
test('single-player localnet journey: start + play', async () => {
    const engine = await LocalnetTicTacToeEngine.create(projectRoot);
    const setup = await engine.initGame(2);
    assert.equal(setup.every((s) => s.ok), true);
    // Single-player game flow
    assert.equal((await engine.createOpen()).ok, true);
    assert.equal((await engine.startSingle()).ok, true);
    assert.equal((await engine.playTTTSingle(0, 0)).ok, true);
    assert.equal((await engine.playTTTSingle(0, 1)).ok, true);
    assert.equal((await engine.playTTTSingle(2, 2)).ok, true);
    let state = engine.getState();
    assert.equal(state.match.status === constants.MATCH_ACTIVE || state.match.status === constants.MATCH_DRAW, true);
    state = engine.getState();
    assert.equal(state.match.status === constants.MATCH_ACTIVE ||
        state.match.status === constants.MATCH_DRAW ||
        state.match.status === constants.MATCH_P1_WIN ||
        state.match.status === constants.MATCH_P2_WIN, true);
});
