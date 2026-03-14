# 5ive-tictactoe client

TypeScript localnet engine, journey tests, and GUI server for TicTacToe.

## Scripts
```bash
npm run build
npm run run
npm run test:localnet
npm run test:journey:localnet
npm run journey:localnet
npm run gui:localnet
```

## GUI
`npm run gui:localnet` then open `http://127.0.0.1:4178`.

## Environment
- `FIVE_RPC_URL` (default `http://127.0.0.1:8899`)
- `FIVE_VM_PROGRAM_ID` (default localnet VM id)
- `FIVE_SCRIPT_ACCOUNT` (optional, reuse deployed script)
- `SOLANA_KEYPAIR_PATH` (default `~/.config/solana/id.json`)
