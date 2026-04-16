export default function handler(req,res){
  const connected=!!(req.cookies?.plaid_access_token);
  const institution=req.cookies?.plaid_institution||null;
  const itemId=req.cookies?.plaid_item_id||null;
  res.status(200).json({connected,institution,itemId,env:process.env.PLAID_ENV||'sandbox'});
}