export type RuntimeNetwork = "localnet" | "devnet" | "mainnet";
export type DeploymentConfig = {
  network: RuntimeNetwork;
  rpcUrl: string;
  fiveProgramId: string;
  tictactoeScriptAccount: string;
  tictactoeConfigAccount: string;
};

export const DEPLOYMENT_CONFIGS: Record<RuntimeNetwork, DeploymentConfig> = {
  "localnet": {
    "network": "localnet",
    "rpcUrl": "http://127.0.0.1:8899",
    "fiveProgramId": "55555SyrYLzydvDMBhAL8uo6h4WETHTm81z8btf6nAVJ",
    "tictactoeScriptAccount": "8nP9KaoWjsD76qxC3AkKwAD9Fu7YMXWeiB7NQ1ZQzTH8",
    "tictactoeConfigAccount": "FSqMr2ASb2U9a9vNgTn3JVTRMtX2zN3LuiwsEZH7k1gA"
  },
  "devnet": {
    "network": "devnet",
    "rpcUrl": "https://solana-devnet.g.alchemy.com/v2/iYUHtW5GGIvK7hTlORbC9",
    "fiveProgramId": "55555SyrYLzydvDMBhAL8uo6h4WETHTm81z8btf6nAVJ",
    "tictactoeScriptAccount": "3RMvPbo2D8cMAbpkhpPK6aW4DfbwCyDrY4DvoSTQMFKb",
    "tictactoeConfigAccount": "BceXS3u5bgi2QUWGxcTJPDbDVtzVcWg56x3hiXuinaKB"
  },
  "mainnet": {
    "network": "mainnet",
    "rpcUrl": "https://solana-mainnet.g.alchemy.com/v2/iYUHtW5GGIvK7hTlORbC9",
    "fiveProgramId": "55555SyrYLzydvDMBhAL8uo6h4WETHTm81z8btf6nAVJ",
    "tictactoeScriptAccount": "EURPiskXDCicEop78uV5VRBXABecfR588XJbmiYKLVGU",
    "tictactoeConfigAccount": "2Kq8EKWz9tdkbCCqrvJCvUVY65VsV9Rt9AWkYZeHCcsJ"
  }
} as const;
