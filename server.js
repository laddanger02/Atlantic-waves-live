// Atlantic Waves - Fixed Deriv OAuth Server
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.DERIV_CLIENT_ID || '1089';
const REDIRECT_URI = process.env.DERIV_REDIRECT_URI || `https://atlantic-waves-live.onrender.com/oauth/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || 'atlantic-waves-super-secret-123456';

console.log(`Starting with CLIENT_ID=${CLIENT_ID} REDIRECT=${REDIRECT_URI}`);

// Session - IMPORTANT for OAuth
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: true, // Render is https
    sameSite: 'lax',
    maxAge: 24*60*60*1000
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Helpers for PKCE
function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function generateVerifier() {
  return base64url(crypto.randomBytes(32));
}
function generateChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// Store pending verifiers (memory + session backup)
const pending = new Map();

// Home
app.get('/', (req, res) => {
  const isAuth =!!req.session.deriv_tokens;
  const loginId = req.session.account_loginid || 'Not connected';

  res.send(`
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atlantic Waves Bot</title>
<style>
body{font-family:Arial;padding:20px;background:#0a0e1a;color:#fff;text-align:center}
.card{background:#151b2e;padding:20px;border-radius:12px;max-width:500px;margin:20px auto}
.btn{padding:12px 24px;border:none;border-radius:8px;font-weight:bold;cursor:pointer;text-decoration:none;display:inline-block;margin:5px}
.btn-connect{background:#ff444f;color:#fff}
.btn-logout{background:#333;color:#fff}
.status-ok{color:#2ecc71}.status-bad{color:#ff444f}
</style>
</head>
<body>
<h1>🌊 Atlantic Waves - Live Bot</h1>
<div class="card">
<p>Server time: ${new Date().toISOString()}</p>
<p>Auth: ${isAuth? `<span class="status-ok">✅ Connected (${loginId})</span>` : `<span class="status-bad">❌ Not connected</span>`}</p>
<p>Client ID: ${CLIENT_ID}</p>
${!isAuth? `<a class="btn btn-connect" href="/auth/login">Connect Deriv</a>` : `<a class="btn btn-logout" href="/auth/logout">Logout</a>`}
</div>
<div class="card">
<h3>Bot Status</h3>
<p>Bot is LIVE - Ready to trade</p>
${isAuth? `<button class="btn btn-connect" onclick="alert('Trading logic active!')">Start Bot</button>` : `<p>Connect first to trade</p>`}
</div>
</body>
</html>
  `);
});

// LOGIN - Start OAuth
app.get('/auth/login', async (req, res) => {
  const state = base64url(crypto.randomBytes(16));
  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);

  // Save in both places
  pending.set(state, { verifier, created: Date.now() });
  if (!req.session.oauth_pending) req.session.oauth_pending = {};
  req.session.oauth_pending[state] = { verifier, created: Date.now() };

  // Ensure session is saved before redirect
  req.session.save(() => {
    const authUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${CLIENT_ID}&l=en&brand=deriv&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&response_type=code&scope=read+trade+trading_information+payments`;
    console.log(`OAuth Start state=${state}`);
    res.redirect(authUrl);
  });
});

// CALLBACK - Handle Deriv redirect
app.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.log('Deriv denied:', error, error_description);
    return res.send(`Deriv auth denied: ${error_description || error}. <a href="/">Back</a>`);
  }

  if (!code ||!state) {
    return res.redirect('/');
  }

  // Try to get verifier from memory or session
  let p = pending.get(state);
  if (!p && req.session.oauth_pending) {
    p = req.session.oauth_pending[state];
  }

  // Clean up immediately to prevent reuse
  pending.delete(state);
  if (req.session.oauth_pending) delete req.session.oauth_pending[state];

  if (!p) {
    console.log('State not found or already used, redirecting home:', state);
    // Don't show error, just go home and let user login again
    return res.redirect('/');
  }

  if (Date.now() - p.created > 10*60*1000) {
    return res.send('Session expired. <a href="/auth/login">Login again</a>');
  }

  try {
    console.log('Exchanging code for token...');
    const tokenRes = await fetch('https://oauth.deriv.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code: code,
        redirect_uri: REDIRECT_URI,
        code_verifier: p.verifier
      })
    });

    const tokenData = await tokenRes.json();
    console.log('Token response:', JSON.stringify(tokenData).slice(0, 200));

    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || JSON.stringify(tokenData));
    }

    // Save tokens
    req.session.deriv_tokens = tokenData;
    req.session.account_loginid = tokenData.loginid || 'Connected';

    req.session.save(() => {
      res.redirect('/');
    });

  } catch (err) {
    console.error('Token exchange failed:', err);
    res.status(500).send(`Deriv auth failed: ${err.message}. This usually means verifier was reused. <a href="/auth/login">Try login again (1 click only)</a>`);
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/api/status', (req, res) => {
  res.json({ connected:!!req.session.deriv_tokens, client_id: CLIENT_ID, loginid: req.session.account_loginid || null });
});

app.listen(PORT, () => console.log(`Atlantic Waves LIVE on ${PORT}`));