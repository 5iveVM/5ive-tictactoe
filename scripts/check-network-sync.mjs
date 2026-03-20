#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import web3 from '../../five-cli/node_modules/@solana/web3.js/lib/index.cjs.js';
import {
  SUPPORTED_NETWORKS,
  normalizeNetwork,
  loadAllDeploymentConfigs,
  resolveRuntimeConfig,
} from './lib/runtime-config.mjs';

const { Connection, PublicKey } = web3;

function parseArgs(argv) {
  const out = { all: false, networks: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--all') out.all = true;
    if (token === '--network' && argv[i + 1]) out.networks.push(normalizeNetwork(argv[++i]));
  }
  return out;
}

function parseSimpleEnv(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

function webOverrides(env, network) {
  if (env.NEXT_PUBLIC_TTT_USE_ENV_OVERRIDES !== '1') return {};
  const suffix = network === 'localnet' ? 'LOCALNET' : network === 'devnet' ? 'DEVNET' : 'MAINNET';
  return {
    rpcUrl: env[`NEXT_PUBLIC_${suffix}_RPC_URL`] || env.NEXT_PUBLIC_RPC_URL,
    fiveProgramId: env.NEXT_PUBLIC_FIVE_VM_PROGRAM_ID,
    tictactoeScriptAccount:
      env[`NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT_${suffix}`] || env.NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT,
    tictactoeConfigAccount:
      env[`NEXT_PUBLIC_TTT_CONFIG_ACCOUNT_${suffix}`] || env.NEXT_PUBLIC_TTT_CONFIG_ACCOUNT,
  };
}

function clientOverrides(env) {
  if (env.FIVE_USE_ENV_OVERRIDES !== '1') return {};
  return {
    rpcUrl: env.FIVE_RPC_URL,
    fiveProgramId: env.FIVE_VM_PROGRAM_ID,
    tictactoeScriptAccount: env.FIVE_SCRIPT_ACCOUNT,
    tictactoeConfigAccount: env.FIVE_TTT_CONFIG_ACCOUNT,
  };
}

const strictOnchain = process.env.FIVE_SYNC_STRICT_ONCHAIN === '1';

async function checkOnchain({ network, config }) {
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const checks = [
    ['vm program', config.fiveProgramId],
    ['script account', config.tictactoeScriptAccount],
    ['config account', config.tictactoeConfigAccount],
  ];
  const result = [];
  for (const [label, key] of checks) {
    try {
      const pk = new PublicKey(key);
      const info = await connection.getAccountInfo(pk, 'confirmed');
      result.push({ label, key, ok: !!info });
    } catch (error) {
      result.push({ label, key, ok: false, err: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = resolve(new URL('..', import.meta.url).pathname);
  const webEnvPath = resolve(projectRoot, 'web/.env.local');
  const webEnv = parseSimpleEnv(await readFile(webEnvPath, 'utf8'));
  const deploymentConfigs = await loadAllDeploymentConfigs(projectRoot);
  const targetNetworks = args.all || args.networks.length === 0 ? SUPPORTED_NETWORKS : args.networks;

  let failures = 0;
  for (const network of targetNetworks) {
    const base = deploymentConfigs[network];
    const webResolved = resolveRuntimeConfig({
      network,
      deploymentConfig: base,
      overrides: webOverrides(webEnv, network),
    });
    const clientResolved = resolveRuntimeConfig({
      network,
      deploymentConfig: base,
      overrides: clientOverrides(process.env),
    });

    const same =
      webResolved.fiveProgramId === clientResolved.fiveProgramId &&
      webResolved.tictactoeScriptAccount === clientResolved.tictactoeScriptAccount &&
      webResolved.tictactoeConfigAccount === clientResolved.tictactoeConfigAccount;

    const onchain = await checkOnchain({ network, config: webResolved });
    const onchainOk = onchain.every((row) => row.ok);

    console.log(`\n[${network}]`);
    console.log(`  web script:    ${webResolved.tictactoeScriptAccount}`);
    console.log(`  client script: ${clientResolved.tictactoeScriptAccount}`);
    console.log(`  config:        ${webResolved.tictactoeConfigAccount}`);
    console.log(`  vm:            ${webResolved.fiveProgramId}`);
    for (const row of onchain) {
      console.log(`  check ${row.label}: ${row.ok ? 'ok' : 'missing'} ${row.err ? `(${row.err})` : ''}`);
    }

    if (!same) {
      failures += 1;
      console.error(`  mismatch: web/client resolution differs for ${network}`);
    }
    if (!onchainOk) {
      const shouldFailOnchain = strictOnchain || network === 'localnet';
      if (shouldFailOnchain) {
        failures += 1;
        console.error(`  mismatch: required accounts missing on-chain for ${network}`);
      } else {
        console.warn(`  warning: accounts missing on-chain for ${network} (non-strict mode)`);
      }
    }
  }

  if (failures > 0) process.exit(1);
  console.log('\ncheck-network-sync: all selected networks are in sync.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
