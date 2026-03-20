#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { normalizeNetwork } from './lib/runtime-config.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const inputNetwork = process.argv[2] || 'localnet';
const network = normalizeNetwork(inputNetwork);
const target = network === 'localnet' ? 'local' : network;
const configPath = resolve(projectRoot, `deployment-config.${network}.json`);

const deploy = spawnSync(
  'node',
  ['../five-cli/dist/index.js', 'deploy', 'build/*.five', '--project', '.', '--target', target],
  {
    cwd: projectRoot,
    shell: true,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  }
);

if (deploy.stdout) process.stdout.write(deploy.stdout);
if (deploy.stderr) process.stderr.write(deploy.stderr);
if ((deploy.status ?? 1) !== 0) process.exit(deploy.status ?? 1);

const combined = `${deploy.stdout || ''}\n${deploy.stderr || ''}`;
const match = combined.match(/Script Account\s+([1-9A-HJ-NP-Za-km-z]{32,44})/);
if (!match) {
  console.error('Unable to extract deployed script account from CLI output.');
  process.exit(1);
}
const scriptAccount = match[1];

const current = JSON.parse(await readFile(configPath, 'utf8'));
const next = {
  ...current,
  network,
  rpcUrl:
    process.env.FIVE_RPC_URL ||
    current.rpcUrl ||
    (network === 'localnet'
      ? 'http://127.0.0.1:8899'
      : network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.mainnet-beta.solana.com'),
  fiveProgramId: process.env.FIVE_VM_PROGRAM_ID || current.fiveProgramId,
  tictactoeScriptAccount: scriptAccount,
  updatedAt: new Date().toISOString(),
};

await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`[deploy-and-record] updated ${configPath}`);

