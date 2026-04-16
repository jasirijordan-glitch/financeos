import { serialize } from 'cookie';

export default async function handler(req, res) {
  const { code, realmId, state, error } = req.query;

  if (error) {
    return res.redirect('/?qbo_error=' + encodeURIComponent(error));
  }

  if (!code || !realmId) {
    return res.redirect('/?qbo_error=missing_params');
  }

  const clientId     = process.env.QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  const redirectUri  = process.env.QB_REDIRECT_URI || ('https://' + req.headers.host + '/api/qbo/callback');

  try {
    const basic = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + basic,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    });
    const tokens = await tokenRes.json();

    if (tokens.access_token) {
      // Store tokens in HTTP-only cookies (simple session approach)
      res.setHeader('Set-Cookie', [
        serialize('qbo_access_token',  tokens.access_token,  { httpOnly: true, secure: true, path: '/', maxAge: tokens.expires_in || 3600 }),
        serialize('qbo_refresh_token', tokens.refresh_token, { httpOnly: true, secure: true, path: '/', maxAge: 60 * 60 * 24 * 100 }),
        serialize('qbo_realm_id',      realmId,              { httpOnly: true, secure: true, path: '/', maxAge: 60 * 60 * 24 * 100 }),
      ]);
      return res.redirect('/?qbo_connected=true');
    } else {
      return res.redirect('/?qbo_error=' + encodeURIComponent(tokens.error_description || 'token_error'));
    }
  } catch (e) {
    return res.redirect('/?qbo_error=' + encodeURIComponent(e.message));
  }
}