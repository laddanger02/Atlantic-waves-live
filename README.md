# Atlantic Waves — Deriv Live Trading

This build uses Deriv OAuth 2.0 + PKCE and an authenticated Deriv trading WebSocket.

## 1. Register the Deriv application

Open the Deriv developer dashboard and choose **Register Application**.

- App type: **OAuth 2.0**
- App name: **Atlantic Waves**
- Redirect URL: `https://YOUR-DOMAIN/oauth/callback`
- Verification URL: use the same URL unless you have a separate verification endpoint.
- Scope: **trade** only for this trading build.

The redirect URL in Deriv must exactly match `DERIV_REDIRECT_URI` in `.env`.

For local testing, Deriv allows `http://localhost`; use:
`http://localhost:3000/oauth/callback`

## 2. Configure the server

Copy `.env.example` to `.env` and set:

```text
PORT=3000
NODE_ENV=development
SESSION_SECRET=<long-random-secret>
DERIV_CLIENT_ID=<client-id-from-deriv>
DERIV_REDIRECT_URI=https://YOUR-DOMAIN/oauth/callback
```

Do not put an OAuth access token, password, PAT, or secret into the browser code.

## 3. Install and run

```bash
npm install
npm start
```

Open the server URL in Chrome.

## 4. First test: DEMO

1. Choose **Connect Deriv Account**.
2. Log in at Deriv and approve Atlantic Waves.
3. Select the DEMO account.
4. Open the authenticated trading connection.
5. Confirm the balance and live ticks appear.
6. Start the bot and observe demo contracts and P/L.
7. Test the stop button and hard loss/profit limits.

## 5. Real account

Only after the demo connection and strategy have been verified should the real account be selected. The real-money start button requires an explicit confirmation.

Risk controls in this build:
- $1 starting stake
- 1.70x progression after a loss
- $8 maximum stake
- 4 consecutive-loss stop
- $15 session/daily loss stop
- $25 profit target
- Manual STOP BOT

These controls reduce exposure but cannot guarantee profit.
