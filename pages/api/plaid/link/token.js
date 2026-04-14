export default async function handler(req,res){
  const clientId=process.env.PLAID_CLIENT_ID;
  const secret=process.env.PLAID_SECRET;
  if(!clientId||!secret) return res.status(400).json({error:'Not configured',setup:true});
  const env=process.env.PLAID_ENV||'sandbox';
  const base=env==='production'?'https://production.plaid.com':env==='development'?'https://development.plaid.com':'https://sandbox.plaid.com';
  try{
    const r=await fetch(base+'/link/token/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:clientId,secret,user:{client_user_id:'financeos-user'},client_name:'FinanceOS',products:['transactions'],country_codes:['US'],language:'en'})});
    const d=await r.json();
    if(d.link_token) return res.status(200).json({link_token:d.link_token});
    return res.status(400).json({error:d.error_message||'Plaid API error',display_message:d.display_message||''});
  }catch(e){return res.status(500).json({error:e.message});}
}