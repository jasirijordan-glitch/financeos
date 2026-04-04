export default function handler(req,res){if(req.method==='DELETE')return res.status(200).json({ok:true});res.status(200).json({...req.body})}
