# 5ive-tictactoe

TicTacToe two-wallet PvP on 5IVE VM.

## Features
- TicTacToe-only contract mode
- Open lobby or direct invite matchmaking
- Turn-based two-wallet gameplay
- On-chain timeout claim (`claim_timeout`)
- Localnet GUI with technical panel at bottom

## Commands
```bash
npm run build
npm test
npm run test:onchain:local
npm run client:run:local
npm run client:test:localnet
npm run client:test:journey:localnet
npm run client:gui:localnet
```

## Contract API
- `init_config(config, authority, turn_timeout_secs, allow_open_matches, allow_invites)`
- `init_profile(profile, owner)`
- `create_open_match(config, match_state, player1, mode)` (`mode` must be TicTacToe)
- `create_invite_match(config, match_state, player1, invited_player, mode)` (`mode` must be TicTacToe)
- `join_match(config, match_state, player2)`
- `play_ttt(match_state, caller, cell_index)`
- `claim_timeout(match_state, caller)`
- `resign(match_state, caller)`
- `cancel_waiting_match(match_state, caller)`
- `get_match_status(match_state)`
- `get_match_turn(match_state)`
- `get_match_winner(match_state)`

## Localnet GUI
Run:
```bash
npm run client:gui:localnet
```
Open `http://127.0.0.1:4178`.
