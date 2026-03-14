#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const input = (process.argv[2] || '').toLowerCase();
const network = input === 'local' ? 'localnet' : input;
const defaultRpcUrl = process.env.FIVE_RPC_URL || 'http://127.0.0.1:8899';
const defaultVmProgramId =
  process.env.FIVE_VM_PROGRAM_ID || '5ive58PJUPaTyAe7tvU1bvBi25o7oieLLTRsJDoQNJst';

if (!['localnet', 'devnet', 'mainnet'].includes(network)) {
  console.error('Usage: node scripts/run-onchain.mjs <localnet|devnet|mainnet>');
  process.exit(1);
}

const run = (cmd, args, extraEnv = {}) => {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
};

const runCapture = (cmd, args, extraEnv = {}) =>
  spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });

if (network === 'localnet') {
  const rpcCheck = runCapture('solana', ['-u', defaultRpcUrl, 'cluster-version']);
  if ((rpcCheck.status ?? 1) !== 0) {
    console.error(
      `Localnet RPC is not reachable at ${defaultRpcUrl}.\n` +
        'Start validator first, for example:\n' +
        `  solana-test-validator --reset --bpf-program ${defaultVmProgramId} target/deploy/five.so`
    );
    process.exit(1);
  }

  const programCheck = runCapture('solana', ['-u', defaultRpcUrl, 'account', defaultVmProgramId, '--output', 'json']);
  if ((programCheck.status ?? 1) !== 0) {
    console.error(
      `Five VM program ${defaultVmProgramId} was not found on ${defaultRpcUrl}.\n` +
        'Start validator with the program preloaded, for example:\n' +
        `  solana-test-validator --reset --bpf-program ${defaultVmProgramId} target/deploy/five.so\n` +
        'Or set FIVE_VM_PROGRAM_ID to a deployed local program id.'
    );
    process.exit(1);
  }

  run('npm', ['run', 'client:run:local'], {
    FIVE_RPC_URL: defaultRpcUrl,
    FIVE_VM_PROGRAM_ID: defaultVmProgramId,
  });
  process.exit(0);
}

if (network === 'devnet') {
  run('npm', ['run', 'client:run:devnet']);
  process.exit(0);
}

if (process.env.ALLOW_MAINNET_TESTS !== '1') {
  console.error(
    'Mainnet test run blocked. Set ALLOW_MAINNET_TESTS=1 to permit live mainnet transactions.\n' +
    'For non-submitting validation, use: npm run test:onchain:mainnet:preflight'
  );
  process.exit(1);
}

run('npm', ['run', 'client:run:mainnet']);
