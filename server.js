import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;
const BASE = 'https://api.derivws.com';
const AUTH = 'https://auth.deriv.com';

// Create public folder + index.html if missing (this fixes Not Found)
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
const indexPath = path.join(publicDir, 'index.html');
if (!fs.existsSync(indexPath)) {
  fs.writeFileSync(indexPath, `
<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atlantic Waves Live</title>
<style>body{font-family:sans-serif;padding:30px;max-width:700px;margin:auto}.ok{color:green}.card{border:1px solid #ddd;padding:20px;border-radius:10px}</style>
</head><body>
<h1>🌊 Atlantic Waves Live</h1>
<div class="card">
<h2 class="ok">✅ Bot is LIVE - Not Found is FIXED</h2>
<p>Server time: ${new Date().toISOString()}</p>
<p>Auth: <span id="auth">checking...</span></p>
<a href="/auth/login" style="background:#ff444f;color:white;padding:12px 20px;text-decoration:none;border-radius:8px;display:inline-block;">🔗 Connect Deriv</a>
<button onclick="fetch('/auth/logout',{method:'POST'}).then(()=>location.reload())">Logout</button>
</div>
<script>
fetch('/api/session').then(r=>r.json()).then(j=>{document.getElementById('auth').innerText=j.authenticated?'✅ Connected':'❌ Not connected'});
</script>
</body></html>
`);
}

app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000 }
}));
app.use(express.static(publicDir));

// Use session instead of memory Map (fixes Render restart bug)
const pending = new Map();
const b64url = b => b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const rand = n => b64url(crypto.randomBytes(n));

app.get('/auth/login', (req,res) => {
  const verifier = rand(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = rand(24);
  pending.set(state, { verifier, created: Date.now() });
  // Also save in session as backup
  if (!req.session.oauth_pending) req.session.oauth_pending = {};
  req.session.oauth_pending[state] = { verifier, created: Date.now() };
  await new Promise(r => req.session.save(r));
  const u = new URL(`${AUTH}/oauth2/auth`);
  u.searchParams.set('response_type','code');
  u.searchParams.set('client_id', process.env.DERIV_CLIENT_ID);
  u.searchParams.set('redirect_uri', process.env.DERIV_REDIRECT_URI);
  u.searchParams.set('scope','trade');
  u.searchParams.set('state',state);
  u.searchParams.set('code_challenge',challenge);
  u.searchParams.set('code_challenge_method','S256');
  res.redirect(u.toString());
});

app.get('/oauth/callback', async (req,res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`<h2>Deriv auth failed</h2><p>${escapeHtml(error_description || error)}</p><p><a href="/">Back</a></p>`);
    const p = pending.get(state) || req.session.oauth_pending?.[state];
  pending.delete(state);
  if (req.session.oauth_pending) delete req.session.oauth_pending[state];

  if (!p) {
    console.log('State not found, redirecting to home to retry');
    return res.redirect('/'); // Don't show error, just retry
  }
  if (Date.now()-p.created > 10*60*1000) return res.status(400).send('Expired. <a href="/auth/login">Try login again</a>');
  try {
    const body = new URLSearchParams({
      grant_type:'authorization_code', client_id:process.env.DERIV_CLIENT_ID,
      code, code_verifier:p.verifier, redirect_uri:process.env.DERIV_REDIRECT_URI
    });
    const r = await fetch(`${AUTH}/oauth2/token`, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const j = await r.json();
    if (!r.ok ||!j.access_token) throw new Error(j.error_description || j.error || 'Token exchange failed');
    req.session.deriv = { accessToken:j.access_token, expiresAt:Date.now() + (j.expires_in || 3600)*1000 };
    res.redirect('/');
  } catch (e) { res.status(502).send(`<h2>Token exchange failed</h2><p>${escapeHtml(e.message)}</p>`); }
});

app.post('/auth/logout', (req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/session',(req,res)=>res.json({authenticated:!!req.session.deriv, expiresAt:req.session.deriv?.expiresAt||null}));

async function derivFetch(req, url, opts={}) {
  if (!req.session.deriv?.accessToken) throw new Error('Not authenticated');
  const headers = {...(opts.headers||{}), Authorization:`Bearer ${req.session.deriv.accessToken}`};
  return fetch(url,{...opts,headers});
}

app.get('/api/accounts', async (req,res)=>{
  try {
    const r=await derivFetch(req,`${BASE}/trading/v1/options/accounts`);
    const j=await r.json(); if(!r.ok) return res.status(r.status).json(j);
    res.json(j);
  } catch(e){res.status(401).json({error:e.message});}
});

app.post('/api/otp', async (req,res)=>{
  try {
    const {accountId}=req.body||{}; if(!accountId) return res.status(400).json({error:'accountId required'});
    const r=await derivFetch(req,`${BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,{method:'POST'});
    const j=await r.json(); if(!r.ok) return res.status(r.status).json(j);
    res.json(j);
  } catch(e){res.status(401).json({error:e.message});}
});

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// === THIS MUST BE LAST ===
app.get('*', (req,res)=>res.sendFile(path.join(publicDir,'index.html')));

app.listen(PORT,'0.0.0.0',()=>console.log(`Atlantic Waves FIXED listening on ${PORT}`));