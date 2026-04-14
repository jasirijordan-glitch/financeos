export default function handler(req,res){
  const clientId=process.env.QB_CLIENT_ID;
  if(!clientId) return res.status(200).json({error:'Not configured',setup:true});
  const redirectUri=process.env.QB_REDIRECT_URI||('https://'+req.headers.host+'/api/qbo/callback');
  const state=Date.now().toString(36);
  const url='https://appcenter.intuit.com/connect/oauth2?client_id='+clientId+'&redirect_uri='+encodeURIComponent(redirectUri)+'&response_type=code&scope=com.intuit.quickbooks.accounting&state='+state;
  res.redirect(302,url);
}