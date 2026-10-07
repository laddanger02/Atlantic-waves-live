const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const CLIENT_ID = (process.env.DERIV_CLIENT_ID || '34BVTJXlEDd9Q35hozLPY').trim();
const REDIRECT_URI = (process.env.DERIV_REDIRECT_URI || 'https://atlantic-waves-8kf7.onrender.com/oauth/callback').trim();
const SESSION_SECRET = process.env.SESSION_SECRET || 'atlantic-secret-123';

app.use(session({ secret: SESSION_SECRET, resave:true, saveUninitialized:true, cookie:{secure:false,maxAge:86400000}}));
app.use(express.static(path.join(__dirname, 'public')));
function b64url(b){return b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}

app.get('/api/me',(req,res)=>res.json({connected:!!req.session.tokens, tokens:req.session.tokens||null, client_id:CLIENT_ID}));

// Auth routes
app.get('/auth/login',(req,res)=>{
  const s=b64url(crypto.randomBytes(16));
  const v=b64url(crypto.randomBytes(32));
  const c=b64url(crypto.createHash('sha256').update(v).digest());
  req.session.oauth_state=s; req.session.oauth_verifier=v;
  req.session.save(()=>res.redirect(`https://auth.deriv.com/oauth2/auth?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=trade&code_challenge=${c}&code_challenge_method=S256&state=${s}`));
});

app.get('/oauth/callback',(req,res)=>{
  const {code,state}=req.query;
  if(!code||state!==req.session.oauth_state) return res.redirect('/');
  const v=req.session.oauth_verifier; delete req.session.oauth_state; delete req.session.oauth_verifier;
  const pd=`grant_type=authorization_code&client_id=${CLIENT_ID}&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_verifier=${v}`;
  const opts={hostname:'auth.deriv.com',path:'/oauth2/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(pd)}};
  const r=https.request(opts,rr=>{let d='';rr.on('data',c=>d+=c);rr.on('end',()=>{try{const j=JSON.parse(d);if(!j.access_token) throw new Error(d);req.session.tokens=j;req.session.save(()=>res.redirect('/'));}catch(e){res.send(`Auth failed: ${d} <a href="/">home</a>`);}});});
  r.on('error',e=>res.send('Network error')); r.write(pd); r.end();
});

app.get('/auth/logout',(req,res)=>req.session.destroy(()=>res.redirect('/')));

// Fallback to your real index.html
app.get('*',(req,res)=>{
  if(req.path.startsWith('/auth')||req.path.startsWith('/oauth')||req.path.startsWith('/api')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT,()=>console.log('Serving REAL public/index.html on '+PORT));