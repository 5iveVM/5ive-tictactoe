import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveClientRuntimeConfig } from "../src/runtime-config.js";

const BASE = {
  network: "localnet",
  rpcUrl: "http://127.0.0.1:8899",
  fiveProgramId: "55555SyrYLzydvDMBhAL8uo6h4WETHTm81z8btf6nAVJ",
  vmStatePda: "7utm673i6SYNBkBsjpD4fBo9oXP6U5AkvVHrSwBrAPMf",
  tictactoeScriptAccount: "GKLD3SzppqcRbRosEaZkZLsJT3mRGPd5SXhrj12J6oti",
  tictactoeConfigAccount: "7uKNUtetiz7frVY7b6UZkwVqpdNL4RFdXngugMX2f1iW",
  updatedAt: "2026-03-20T00:00:00.000Z",
};

async function writeConfigs(dir: string) {
  const local = { ...BASE, network: "localnet" };
  const dev = { ...BASE, network: "devnet" };
  const main = { ...BASE, network: "mainnet", rpcUrl: "https://api.mainnet-beta.solana.com" };
  await writeFile(join(dir, "deployment-config.localnet.json"), JSON.stringify(local, null, 2));
  await writeFile(join(dir, "deployment-config.devnet.json"), JSON.stringify(dev, null, 2));
  await writeFile(join(dir, "deployment-config.mainnet.json"), JSON.stringify(main, null, 2));
}

test("resolveClientRuntimeConfig loads deployment-config defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "ttt-config-"));
  await writeConfigs(root);
  const cfg = await resolveClientRuntimeConfig(root, "localnet", {});
  assert.equal(cfg.network, "localnet");
  assert.equal(cfg.rpcUrl, BASE.rpcUrl);
  assert.equal(cfg.fiveProgramId, BASE.fiveProgramId);
  assert.equal(cfg.tictactoeScriptAccount, BASE.tictactoeScriptAccount);
  assert.equal(cfg.tictactoeConfigAccount, BASE.tictactoeConfigAccount);
});

test("resolveClientRuntimeConfig applies explicit function overrides first", async () => {
  const root = await mkdtemp(join(tmpdir(), "ttt-config-"));
  await writeConfigs(root);
  const cfg = await resolveClientRuntimeConfig(root, "localnet", {}, {
    rpcUrl: "http://localhost:8899",
    fiveProgramId: "55555SyrYLzydvDMBhAL8uo6h4WETHTm81z8btf6nAVJ",
    tictactoeScriptAccount: "4FhigcfoHwJXVEaFBXHUFcxmYQakr92pLCZvE4DFUhSW",
    tictactoeConfigAccount: "BceXS3u5bgi2QUWGxcTJPDbDVtzVcWg56x3hiXuinaKB",
  });
  assert.equal(cfg.rpcUrl, "http://localhost:8899");
  assert.equal(cfg.tictactoeScriptAccount, "4FhigcfoHwJXVEaFBXHUFcxmYQakr92pLCZvE4DFUhSW");
  assert.equal(cfg.tictactoeConfigAccount, "BceXS3u5bgi2QUWGxcTJPDbDVtzVcWg56x3hiXuinaKB");
});

test("resolveClientRuntimeConfig uses env overrides only when FIVE_USE_ENV_OVERRIDES=1", async () => {
  const root = await mkdtemp(join(tmpdir(), "ttt-config-"));
  await writeConfigs(root);
  const cfg = await resolveClientRuntimeConfig(root, "localnet", {
    FIVE_USE_ENV_OVERRIDES: "1",
    FIVE_RPC_URL: "http://localhost:8899",
    FIVE_VM_PROGRAM_ID: "55555SyrYLzydvDMBhAL8uo6h4WETHTm81z8btf6nAVJ",
    FIVE_SCRIPT_ACCOUNT: "4FhigcfoHwJXVEaFBXHUFcxmYQakr92pLCZvE4DFUhSW",
    FIVE_TTT_CONFIG_ACCOUNT: "BceXS3u5bgi2QUWGxcTJPDbDVtzVcWg56x3hiXuinaKB",
  });
  assert.equal(cfg.rpcUrl, "http://localhost:8899");
  assert.equal(cfg.tictactoeScriptAccount, "4FhigcfoHwJXVEaFBXHUFcxmYQakr92pLCZvE4DFUhSW");
  assert.equal(cfg.tictactoeConfigAccount, "BceXS3u5bgi2QUWGxcTJPDbDVtzVcWg56x3hiXuinaKB");
});

test("resolveClientRuntimeConfig ignores env overrides by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "ttt-config-"));
  await writeConfigs(root);
  const cfg = await resolveClientRuntimeConfig(root, "localnet", {
    FIVE_RPC_URL: "http://localhost:8899",
    FIVE_VM_PROGRAM_ID: "55555SyrYLzydvDMBhAL8uo6h4WETHTm81z8btf6nAVJ",
    FIVE_SCRIPT_ACCOUNT: "4FhigcfoHwJXVEaFBXHUFcxmYQakr92pLCZvE4DFUhSW",
    FIVE_TTT_CONFIG_ACCOUNT: "BceXS3u5bgi2QUWGxcTJPDbDVtzVcWg56x3hiXuinaKB",
  });
  assert.equal(cfg.rpcUrl, BASE.rpcUrl);
  assert.equal(cfg.tictactoeScriptAccount, BASE.tictactoeScriptAccount);
  assert.equal(cfg.tictactoeConfigAccount, BASE.tictactoeConfigAccount);
});
