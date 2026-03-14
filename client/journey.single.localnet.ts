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
  steps.push({ createOpen: await engine.createOpen() });
  steps.push({ startSingle: await engine.startSingle() });

  for (const [row, col] of [[0, 0], [0, 1], [1, 1], [2, 2], [2, 0], [1, 2]]) {
    if (engine.getState().match.status !== 1) break;
    steps.push({ singleMove: { row, col, result: await engine.playTTTSingle(row, col) } });
  }

  console.log(JSON.stringify({ steps, finalState: engine.getState(), addresses: engine.getAddresses() }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
