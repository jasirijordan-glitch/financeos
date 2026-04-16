export default async function handler(req, res) {
  const { code, realmId, error } = req.query;

  if (error || !code) {
    return res.redirect('/?tab=integrations&qbo_error=' + encodeURIComponent(error || 'no_code'));
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
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString()
    });
    const tokens = await tokenRes.json();

    if (tokens.access_token) {
      const maxAge = 60 * 60 * 24 * 100;
      res.setHeader('Set-Cookie', [
        'qbo_access_token='  + tokens.access_token  + '; HttpOnly; Secure; Path=/; Max-Age=' + (tokens.expires_in || 3600),
        'qbo_refresh_token=' + tokens.refresh_token + '; HttpOnly; Secure; Path=/; Max-Age=' + maxAge,
        'qbo_realm_id='      + realmId              + '; HttpOnly; Secure; Path=/; Max-Age=' + maxAge,
      ]);
      return res.redirect('/?qbo_connected=1');
    }
    return res.redirect('/?tab=integrations&qbo_error=' + encodeURIComponent(tokens.error_description || 'token_failed'));
  } catch (e) {
    return res.redirect('/?tab=integrations&qbo_error=' + encodeURIComponent(e.message));
  }
}