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

test('gui server mock wallet: build + send + commit flow works', async () => {
  const proc = spawn('node', ['dist/gui-server.js'], {
    cwd: clientRoot,
    stdio: 'pipe',
  });

  try {
    await waitForServerReady();

    const mock = await post('/api/mock-wallet');
    assert.equal(mock.status, 200);
    assert.equal(mock.data.ok, true);
    const wallet = String(mock.data.address || '');
    assert.ok(wallet.length > 20);

    const built = await post('/api/build-wallet-action', {
      action: 'init',
      wallet,
      turnTimeoutSecs: 120,
    });
    assert.equal(built.status, 200);
    assert.equal(built.data.functionName, 'init_config');
    assert.ok(typeof built.data.txBase64 === 'string' && built.data.txBase64.length > 10);

    const sent = await post('/api/mock-send', { txBase64: built.data.txBase64 });
    assert.equal(sent.status, 200);
    assert.equal(sent.data.ok, true);
    assert.ok(typeof sent.data.signature === 'string' && sent.data.signature.length > 20);

    const committed = await post('/api/commit-wallet-action', {
      action: 'init',
      wallet,
      signature: sent.data.signature,
      confirmedSlot: sent.data.confirmedSlot,
      turnTimeoutSecs: 120,
    });
    assert.equal(committed.status, 200);
    assert.equal(committed.data.ok, true);
    assert.equal(committed.data.state?.config?.turnTimeoutSecs, 120);
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 250));
    if (!proc.killed) proc.kill('SIGKILL');
  }
});
