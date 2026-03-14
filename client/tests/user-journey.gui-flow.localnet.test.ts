import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientRoot = resolve(__dirname, '..', '..');
const guiUrl = 'http://127.0.0.1:4178';

async function waitForServerReady(timeoutMs = 60000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${guiUrl}/`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('GUI server did not become ready in time');
}

async function post(path: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${guiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    data: (await res.json()) as Record<string, any>,
  };
}

test('gui user journey flow: single-player sequence mapping and state transitions', async () => {
  const proc = spawn('node', ['dist/gui-server.js'], {
    cwd: clientRoot,
    stdio: 'pipe',
  });

  try {
    await waitForServerReady();

    const mock = await post('/api/mock-wallet');
    assert.equal(mock.status, 200);
    const wallet = String(mock.data.address || '');
    assert.ok(wallet.length > 20);

    const buildCreate = await post('/api/build-wallet-action', { action: 'create-open', wallet });
    assert.equal(buildCreate.status, 200);
    assert.equal(buildCreate.data.functionName, 'create_open_match');

    const buildStartSingle = await post('/api/build-wallet-action', { action: 'start-single', wallet });
    assert.equal(buildStartSingle.status, 200);
    assert.equal(buildStartSingle.data.functionName, 'start_single_player');

    const buildMove = await post('/api/build-wallet-action', { action: 'single-move', wallet, row: 0, col: 0 });
    assert.equal(buildMove.status, 200);
    assert.equal(buildMove.data.functionName, 'play_ttt_single');

    const buildResign = await post('/api/build-wallet-action', { action: 'resign', wallet, role: 'p1' });
    assert.equal(buildResign.status, 200);
    assert.equal(buildResign.data.functionName, 'resign');

    // Commit the exact GUI flow order used by New Game and gameplay.
    let slot = 1;
    let committed = await post('/api/commit-wallet-action', {
      action: 'create-open',
      wallet,
      signature: `sig-${slot}`,
      confirmedSlot: slot++,
    });
    assert.equal(committed.status, 200);
    assert.equal(committed.data.state?.match?.status, 0); // waiting

    committed = await post('/api/commit-wallet-action', {
      action: 'start-single',
      wallet,
      signature: `sig-${slot}`,
      confirmedSlot: slot++,
    });
    assert.equal(committed.status, 200);
    assert.equal(committed.data.state?.match?.status, 1); // active
    assert.equal(committed.data.state?.match?.player1, committed.data.state?.match?.player2);

    committed = await post('/api/commit-wallet-action', {
      action: 'single-move',
      wallet,
      row: 0,
      col: 0,
      signature: `sig-${slot}`,
      confirmedSlot: slot++,
    });
    assert.equal(committed.status, 200);
    assert.ok(committed.data.state?.match?.moveCount >= 1);

    committed = await post('/api/commit-wallet-action', {
      action: 'resign',
      wallet,
      role: 'p1',
      signature: `sig-${slot}`,
      confirmedSlot: slot++,
    });
    assert.equal(committed.status, 200);
    assert.equal(committed.data.state?.match?.status, 3); // p2 win after p1 resign
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 250));
    if (!proc.killed) proc.kill('SIGKILL');
  }
});

