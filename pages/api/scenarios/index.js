export default function handler(req,res){if(req.method==='GET')return res.status(200).json([]);res.status(201).json({id:Date.now(),...req.body})}
