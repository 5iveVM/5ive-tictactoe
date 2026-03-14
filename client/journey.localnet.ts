import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { LocalnetTicTacToeEngine } from './src/localnet-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..', '..');

async function run() {
  const engine = await LocalnetTicTacToeEngine.create(projectRoot);
  const steps: unknown[] = [];

  steps.push({ setup: await engine.initGame(5) });

  steps.push({ createOpenTTT: await engine.createOpen() });
  steps.push({ joinTTT: await engine.join('p2') });
  steps.push({ m1: await engine.playTTT('p1', 0, 0) });
  steps.push({ m2: await engine.playTTT('p2', 1, 0) });
  steps.push({ m3: await engine.playTTT('p1', 0, 1) });
  steps.push({ m4: await engine.playTTT('p2', 1, 1) });
  steps.push({ m5: await engine.playTTT('p1', 0, 2) });
  console.log(
    JSON.stringify(
      {
        steps,
        finalState: engine.getState(),
        addresses: engine.getAddresses(),
        readbacks: await engine.readOnchainSummary(),
      },
      null,
      2
    )
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
