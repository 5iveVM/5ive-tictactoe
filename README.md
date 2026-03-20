# 5ive-tictactoe

TicTacToe contract + tooling for 5IVE VM:
- VM contract in `src/main.v`
- TypeScript localnet engine and tests in `client/`
- Next.js web app in `web/`

## What is currently implemented
- Open and invite match creation
- Two-player turns (`play_ttt`) and single-player flow (`start_single_player`, `play_ttt_single`, `play_cpu_random`)
- Timeout/resign/cancel lifecycle operations
- Session-compatible calls for gameplay/lifecycle methods
- Local, devnet, and mainnet deployment/runtime configs in `deployment-config.<network>.json`

## Important behavior notes
- Match status values:
  - `0`: waiting
  - `1`: active
  - `2`: player1 win
  - `3`: player2 win
  - `4`: draw
  - `5`: cancelled
- The contract tracks turn order, `last_move_index`, and `move_count`.
- A draw is set when `move_count >= 9`.
- `claim_timeout` and `resign` set winners on-chain.
- On-chain line-win detection/occupied-cell enforcement is not implemented in `src/main.v`; board/win validation in local flows is handled by the TypeScript engine/web client state.

## Root scripts

### Build and tests
```bash
npm run build
npm test
npm run smoke
npm run verify
```

### On-chain runs
```bash
npm run test:onchain:local
npm run test:onchain:devnet
npm run test:onchain:mainnet
npm run test:onchain:mainnet:preflight
```

`test:onchain:mainnet` is blocked unless `ALLOW_MAINNET_TESTS=1`.

### Deploy/bootstrap
```bash
npm run deploy:local
npm run deploy:devnet
npm run deploy:mainnet
npm run bootstrap:localnet
```

### Client and web
```bash
npm run client:run:local
npm run client:test:localnet
npm run client:test:journey:localnet
npm run client:test:web-init:localnet
npm run client:journey:localnet

npm run web:install
npm run web:dev
npm run web:build
npm run web:start
```

## Contract API (current ABI)
- `init_config(config, authority, turn_timeout_secs, allow_open_matches, allow_invites)`
- `init_profile(profile, owner)`
- `create_open_match(config, match_state, player1)`
- `create_invite_match(config, match_state, player1, invited_player)`
- `join_match(config, match_state, player2)`
- `start_single_player(match_state, caller)`
- `play_ttt(match_state, caller, cell_index)`
- `play_ttt_single(match_state, caller, cell_index)`
- `play_cpu_random(match_state, caller)`
- `claim_timeout(match_state, caller)`
- `resign(match_state, caller)`
- `cancel_waiting_match(match_state, caller)`
- `close_finished_match(match_state, caller, owner_refund)`
- `get_match_status(match_state)`
- `get_match_turn(match_state)`
- `get_match_winner(match_state)`

## Runtime config and sync
- Source of truth per network is:
  - `deployment-config.localnet.json`
  - `deployment-config.devnet.json`
  - `deployment-config.mainnet.json`
- Client env overrides are only used when `FIVE_USE_ENV_OVERRIDES=1`.
- Web env overrides are only used when `NEXT_PUBLIC_TTT_USE_ENV_OVERRIDES=1`.
- Validate web/client/deployment config alignment:

```bash
npm run check:sync
# optionally:
npm run check:sync -- --all
npm run check:sync -- --network devnet
```

## Session regression smoke
Validates direct and delegated sessionized flows, including canonical PDA session account checks.

```bash
# localnet
FIVE_VM_PROGRAM_ID=<local_vm_program_id> \
FIVE_SCRIPT_ACCOUNT=<deployed_script> \
FIVE_SESSION_MANAGER_SCRIPT_ACCOUNT=<optional_override> \
npm run test:session-smoke:localnet

# devnet
FIVE_SCRIPT_ACCOUNT=<deployed_script> npm run test:session-smoke:devnet
```
