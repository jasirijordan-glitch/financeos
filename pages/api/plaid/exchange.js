export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).end();
  const clientId=process.env.PLAID_CLIENT_ID;
  const secret=process.env.PLAID_SECRET;
  if(!clientId||!secret) return res.status(400).json({error:'Not configured'});
  const env=process.env.PLAID_ENV||'sandbox';
  const base=env==='production'?'https://production.plaid.com':env==='development'?'https://development.plaid.com':'https://sandbox.plaid.com';
  const {publicToken,institutionName}=req.body||{};
  if(!publicToken) return res.status(400).json({error:'Missing publicToken'});
  try{
    const r=await fetch(base+'/item/public_token/exchange',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({client_id:clientId,secret,public_token:publicToken})
    });
    const d=await r.json();
    if(!d.access_token) return res.status(400).json({error:d.error_message||'Exchange failed'});
    const maxAge=60*60*24*100;
    res.setHeader('Set-Cookie',[
      'plaid_access_token='+d.access_token+'; HttpOnly; Secure; Path=/; Max-Age='+maxAge,
      'plaid_item_id='+d.item_id+'; HttpOnly; Secure; Path=/; Max-Age='+maxAge,
      'plaid_institution='+(institutionName||'')+'; Path=/; Max-Age='+maxAge
    ]);
    return res.status(200).json({success:true,itemId:d.item_id,institution:institutionName||'Bank'});
  }catch(e){return res.status(500).json({error:e.message});}
}