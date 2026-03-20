# 5ive TicTacToe

Fast, session-enabled TicTacToe on the 5IVE VM.

- Contract: `src/main.v`
- Local engine + tests: `client/`
- Web app: `web/`

## Quick Start (Local)

```bash
npm install
npm run build
npm run web:install
cp web/.env.example web/.env.local
npm run web:dev
```

Open `http://localhost:3000`.

## Ship Commands

```bash
# quality
npm test
npm run smoke
npm run verify

# deploy
npm run deploy:local
npm run deploy:devnet
npm run deploy:mainnet

# on-chain tests
npm run test:onchain:local
npm run test:onchain:devnet
npm run test:onchain:mainnet:preflight
```

`npm run test:onchain:mainnet` requires `ALLOW_MAINNET_TESTS=1`.

## Game State

- `0` waiting
- `1` active
- `2` player1 win
- `3` player2 win
- `4` draw
- `5` cancelled

Draw is set when `move_count >= 9`. `claim_timeout` and `resign` settle winners on-chain.

## Important Note

This contract currently keeps turn/lifecycle state on-chain, but board line-win and occupied-cell checks are enforced in the TypeScript engine/web flow (not in `src/main.v` yet).

## Config Truth

- Network configs live in:
  - `deployment-config.localnet.json`
  - `deployment-config.devnet.json`
  - `deployment-config.mainnet.json`
- Verify config alignment:

```bash
npm run check:sync
npm run check:sync -- --all
```

For web-specific env and Cloudflare deploy details, see `web/README.md`.
