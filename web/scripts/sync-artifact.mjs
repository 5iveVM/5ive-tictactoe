import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllDeploymentConfigs } from "../../scripts/lib/runtime-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const root = resolve(webDir, "..");
const buildDir = resolve(root, "build");
const mainSrc = resolve(buildDir, "main.five");
const fallback = existsSync(buildDir)
  ? readdirSync(buildDir).find((f) => f.endsWith(".five"))
  : null;
const src = existsSync(mainSrc) ? mainSrc : fallback ? resolve(buildDir, fallback) : mainSrc;
const dst = resolve(webDir, "public", "main.five");

if (!existsSync(src)) {
  console.error(`[sync-artifact] missing ${src}. Run \`npm run build\` in 5ive-tictactoe first.`);
  process.exit(1);
}

cpSync(src, dst);
console.log(`[sync-artifact] copied ${src} -> ${dst}`);

const generatedDir = resolve(webDir, "src", "generated");
const generatedPath = resolve(generatedDir, "deployment-config.ts");
mkdirSync(generatedDir, { recursive: true });
const configs = await loadAllDeploymentConfigs(root);
const moduleText =
  `export type RuntimeNetwork = "localnet" | "devnet" | "mainnet";\n` +
  `export type DeploymentConfig = {\n` +
  `  network: RuntimeNetwork;\n` +
  `  rpcUrl: string;\n` +
  `  fiveProgramId: string;\n` +
  `  tictactoeScriptAccount: string;\n` +
  `  tictactoeConfigAccount: string;\n` +
  `};\n\n` +
  `export const DEPLOYMENT_CONFIGS: Record<RuntimeNetwork, DeploymentConfig> = ${JSON.stringify({
    localnet: {
      network: "localnet",
      rpcUrl: configs.localnet.rpcUrl,
      fiveProgramId: configs.localnet.fiveProgramId,
      tictactoeScriptAccount: configs.localnet.tictactoeScriptAccount,
      tictactoeConfigAccount: configs.localnet.tictactoeConfigAccount,
    },
    devnet: {
      network: "devnet",
      rpcUrl: configs.devnet.rpcUrl,
      fiveProgramId: configs.devnet.fiveProgramId,
      tictactoeScriptAccount: configs.devnet.tictactoeScriptAccount,
      tictactoeConfigAccount: configs.devnet.tictactoeConfigAccount,
    },
    mainnet: {
      network: "mainnet",
      rpcUrl: configs.mainnet.rpcUrl,
      fiveProgramId: configs.mainnet.fiveProgramId,
      tictactoeScriptAccount: configs.mainnet.tictactoeScriptAccount,
      tictactoeConfigAccount: configs.mainnet.tictactoeConfigAccount,
    },
  }, null, 2)} as const;\n`;
writeFileSync(generatedPath, moduleText, "utf8");
console.log(`[sync-artifact] generated ${generatedPath}`);
