export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).end();
  const clientId=process.env.PLAID_CLIENT_ID;
  const secret=process.env.PLAID_SECRET;
  const accessToken=req.cookies?.plaid_access_token;
  if(!clientId||!secret) return res.status(400).json({error:'Not configured'});
  if(!accessToken) return res.status(401).json({error:'Not connected. Please link a bank account first.'});
  const env=process.env.PLAID_ENV||'sandbox';
  const base=env==='production'?'https://production.plaid.com':env==='development'?'https://development.plaid.com':'https://sandbox.plaid.com';
  try{
    const r=await fetch(base+'/accounts/get',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({client_id:clientId,secret,access_token:accessToken})
    });
    const d=await r.json();
    if(d.accounts){
      const institution=req.cookies?.plaid_institution||'Bank';
      return res.status(200).json({success:true,accounts:d.accounts,institution});
    }
    return res.status(400).json({error:d.error_message||'Sync failed'});
  }catch(e){return res.status(500).json({error:e.message});}
}