export default function handler(req,res){res.status(200).json({plan:process.env.DEFAULT_PLAN||'starter'})}
