import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { LocalnetTicTacToeEngine } from './src/localnet-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..', '..');

function hasFailedStep(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasFailedStep(entry));

  const record = value as Record<string, unknown>;
  if ('ok' in record && record.ok === false) return true;

  return Object.values(record).some((entry) => hasFailedStep(entry));
}

async function main() {
  const engine = await LocalnetTicTacToeEngine.create(projectRoot);

  const setup = await engine.initGame(10);
  const create = await engine.createOpen();
  const join = await engine.join('p2');

  const moves = [];
  moves.push(await engine.playTTT('p1', 0, 0));
  moves.push(await engine.playTTT('p2', 1, 0));
  moves.push(await engine.playTTT('p1', 0, 1));
  moves.push(await engine.playTTT('p2', 1, 1));
  moves.push(await engine.playTTT('p1', 0, 2));

  const state = engine.getState();
  const addresses = engine.getAddresses();

  const result = { setup, create, join, moves, state, addresses };
  console.log(JSON.stringify(result, null, 2));

  if (hasFailedStep(result)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
