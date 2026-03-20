import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import web3 from '../../../five-cli/node_modules/@solana/web3.js/lib/index.cjs.js';

const { PublicKey } = web3;

export const SUPPORTED_NETWORKS = ['localnet', 'devnet', 'mainnet'];

function assertPubkey(value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`missing ${label}`);
  }
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

function assertUrl(value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`missing ${label}`);
  }
  try {
    const url = new URL(value);
    if (!url.protocol.startsWith('http')) throw new Error('invalid protocol');
    return value;
  } catch {
    throw new Error(`invalid ${label}: ${value}`);
  }
}

export function normalizeNetwork(input) {
  const raw = String(input || '').toLowerCase();
  if (raw === 'local') return 'localnet';
  if (SUPPORTED_NETWORKS.includes(raw)) return raw;
  throw new Error(`unsupported network '${input}', expected one of: ${SUPPORTED_NETWORKS.join(', ')}`);
}

function configPath(projectRoot, network) {
  return resolve(projectRoot, `deployment-config.${network}.json`);
}

export async function loadDeploymentConfig(projectRoot, network) {
  const normalized = normalizeNetwork(network);
  const path = configPath(projectRoot, normalized);
  const raw = JSON.parse(await readFile(path, 'utf8'));

  return {
    network: normalized,
    rpcUrl: assertUrl(raw.rpcUrl, `${normalized}.rpcUrl`),
    fiveProgramId: assertPubkey(raw.fiveProgramId, `${normalized}.fiveProgramId`),
    tictactoeScriptAccount: assertPubkey(
      raw.tictactoeScriptAccount,
      `${normalized}.tictactoeScriptAccount`
    ),
    tictactoeConfigAccount: assertPubkey(
      raw.tictactoeConfigAccount,
      `${normalized}.tictactoeConfigAccount`
    ),
    vmStatePda: raw.vmStatePda ? assertPubkey(raw.vmStatePda, `${normalized}.vmStatePda`) : undefined,
    updatedAt: raw.updatedAt || null,
    path,
  };
}

export async function loadAllDeploymentConfigs(projectRoot) {
  const entries = await Promise.all(
    SUPPORTED_NETWORKS.map(async (network) => [network, await loadDeploymentConfig(projectRoot, network)])
  );
  return Object.fromEntries(entries);
}

function envOverrideForNetwork(env, network) {
  const suffix = network === 'localnet' ? 'LOCALNET' : network === 'devnet' ? 'DEVNET' : 'MAINNET';
  return {
    rpcUrl:
      env.FIVE_RPC_URL ||
      env.NEXT_PUBLIC_RPC_URL ||
      env[`NEXT_PUBLIC_${suffix}_RPC_URL`] ||
      undefined,
    fiveProgramId: env.FIVE_VM_PROGRAM_ID || env.NEXT_PUBLIC_FIVE_VM_PROGRAM_ID || undefined,
    tictactoeScriptAccount:
      env.FIVE_SCRIPT_ACCOUNT ||
      env[`NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT_${suffix}`] ||
      env.NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT ||
      undefined,
    tictactoeConfigAccount:
      env.FIVE_TTT_CONFIG_ACCOUNT ||
      env[`NEXT_PUBLIC_TTT_CONFIG_ACCOUNT_${suffix}`] ||
      env.NEXT_PUBLIC_TTT_CONFIG_ACCOUNT ||
      undefined,
  };
}

export function resolveRuntimeConfig({ network, deploymentConfig, overrides = {} }) {
  const normalized = normalizeNetwork(network);
  const filteredOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const merged = {
    ...deploymentConfig,
    ...filteredOverrides,
  };
  return {
    network: normalized,
    rpcUrl: assertUrl(merged.rpcUrl, `${normalized}.rpcUrl`),
    fiveProgramId: assertPubkey(merged.fiveProgramId, `${normalized}.fiveProgramId`),
    tictactoeScriptAccount: assertPubkey(
      merged.tictactoeScriptAccount,
      `${normalized}.tictactoeScriptAccount`
    ),
    tictactoeConfigAccount: assertPubkey(
      merged.tictactoeConfigAccount,
      `${normalized}.tictactoeConfigAccount`
    ),
    vmStatePda: merged.vmStatePda || null,
  };
}

export async function resolveFromProject({ projectRoot, network, env = process.env, explicitOverrides = {} }) {
  const normalized = normalizeNetwork(network);
  const deploymentConfig = await loadDeploymentConfig(projectRoot, normalized);
  const envOverrides = envOverrideForNetwork(env, normalized);
  return resolveRuntimeConfig({
    network: normalized,
    deploymentConfig,
    overrides: {
      ...envOverrides,
      ...explicitOverrides,
    },
  });
}
