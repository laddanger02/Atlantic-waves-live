const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;
const CLIENT_ID = (process.env.DERIV_CLIENT_ID || '1089').toString().trim();
const REDIRECT_URI = (process.env.DERIV_REDIRECT_URI || 'https://atlantic-waves-live.onrender.com/oauth/callback').trim();
const SESSION_SECRET = process.env.SESSION_SECRET || 'atlantic-secret-123';

console.log('Starting... CLIENT_ID=', CLIENT_ID);

app.use(session({
  secret: SESSION_SECRET,
  resave: true,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 86400000 }
}));

function b64url(buf){ return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }

app.get('/', (req,res)=>{
  const ok = !!req.session.tokens;
  res.send(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;background:#0a0e1a;color:#fff;text-align:center;padding:30px">
  <h1>Atlantic Waves</h1><p>Client: ${CLIENT_ID}</p><p style="font-size:20px">${ok?'✅ Connected: '+(req.session.tokens.loginid||'OK'):'❌ Not connected'}</p>
  ${ok?'<a href="/auth/logout" style="background:#333;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Logout</a>':'<a href="/auth/login" style="background:#ff444f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Connect Deriv</a>'}
  </body></html>`);
});

app.get('/auth/login', (req,res)=>{
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  req.session.oauth_state = state;
  req.session.oauth_verifier = verifier;
  req.session.save(()=>{
    res.redirect(`https://oauth.deriv.com/oauth2/authorize?app_id=${CLIENT_ID}&l=en&brand=deriv&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&response_type=code&scope=read+trade+payments+trading_information`);
  });
});

app.get('/oauth/callback', (req,res)=>{
  const {code, state, error, error_description} = req.query;
  if(error) return res.send(`Denied: ${error_description} <a href="/">Back</a>`);
  if(!code || state !== req.session.oauth_state) return res.redirect('/auth/login');
  const verifier = req.session.oauth_verifier;
  delete req.session.oauth_state; delete req.session.oauth_verifier;
  const postData = `grant_type=authorization_code&client_id=${CLIENT_ID}&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_verifier=${verifier}`;
  const options = {hostname:'oauth.deriv.com',path:'/oauth2/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(postData)}};
  const apiReq = https.request(options, apiRes=>{let data='';apiRes.on('data',c=>data+=c);apiRes.on('end',()=>{try{const j=JSON.parse(data);if(!j.access_token) throw new Error(j.error_description||data);req.session.tokens=j;req.session.save(()=>res.redirect('/'));}catch(e){res.send(`Auth failed: ${e.message}<br><a href="/auth/login">Try again</a>`);}});});
  apiReq.on('error', e=>res.send(`Network error ${e.message} <a href="/auth/login">Retry</a>`));
  apiReq.write(postData); apiReq.end();
});

app.get('/auth/logout', (req,res)=> req.session.destroy(()=>res.redirect('/')));
app.listen(PORT, ()=> console.log(`LIVE on ${PORT}`));