# 5ive TicTacToe Web

Standalone Next.js web app for 5ive-tictactoe with session-key gameplay.

## Local development

From `5ive-tictactoe/`:

```bash
npm run build
npm run web:install
cp web/.env.example web/.env.local
npm run web:dev
```

Then open `http://localhost:3000`.

## Notes

- Set `NEXT_PUBLIC_FIVE_SCRIPT_ACCOUNT` to your deployed tictactoe script account.
- Use `Provision Accounts` and `Init Config/Profile` once per wallet.
- `New Single Match` creates an open match and starts single-player mode.
- Use `Use Direct Calls` to test without session delegation.
- Use `Create Session` then `Use Session Calls` to test delegated session flow.
- `Create Session` enables delegated key flow for `play_ttt_single` and related actions.
- Session config env:
  - `NEXT_PUBLIC_SESSION_MANAGER_SCRIPT_ACCOUNT` optional override.
  - `NEXT_PUBLIC_SESSION_TTL_SLOTS` optional session TTL slots (default `3000`).

## Cloudflare Pages

From `5ive-tictactoe/web`:

```bash
npm run build
npm run deploy:pages
```
