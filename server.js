import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const BASE = 'https://api.derivws.com';
const AUTH = 'https://auth.deriv.com';

if (!process.env.DERIV_CLIENT_ID || !process.env.DERIV_REDIRECT_URI || !process.env.SESSION_SECRET) {
  console.warn('Set DERIV_CLIENT_ID, DERIV_REDIRECT_URI and SESSION_SECRET in .env before live use.');
}

app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const pending = new Map();
const b64url = b => b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const rand = n => b64url(crypto.randomBytes(n));

app.get('/auth/login', (req,res) => {
  const verifier = rand(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = rand(24);
  pending.set(state, { verifier, created: Date.now() });
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
  if (error) return res.status(400).send(`<h2>Deriv authorization failed</h2><p>${escapeHtml(error_description || error)}</p><p><a href="/">Back to Atlantic Waves</a></p>`);
  const p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now()-p.created > 5*60*1000) return res.status(400).send('Invalid or expired OAuth state.');
  try {
    const body = new URLSearchParams({
      grant_type:'authorization_code', client_id:process.env.DERIV_CLIENT_ID,
      code, code_verifier:p.verifier, redirect_uri:process.env.DERIV_REDIRECT_URI
    });
    const r = await fetch(`${AUTH}/oauth2/token`, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const j = await r.json();
    if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || 'Token exchange failed');
    req.session.deriv = { accessToken:j.access_token, expiresAt:Date.now() + (j.expires_in || 3600)*1000 };
    res.redirect('/');
  } catch (e) { res.status(502).send(`<h2>Deriv token exchange failed</h2><p>${escapeHtml(e.message)}</p>`); }
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
app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/', (req, res) => {
  res.send(`
    <h1>🌊 Atlantic Waves Live is Running!</h1>
    <p>Bot Status: <b>Live</b></p>
    <p><a href="/oauth/callback">Connect Deriv</a></p>
    <p>Server time: ${new Date().toISOString()}</p>
  `);
});
app.listen(PORT,()=>console.log(`Atlantic Waves listening on http://localhost:${PORT}`));
