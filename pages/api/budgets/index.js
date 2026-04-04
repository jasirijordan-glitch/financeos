/**
 * GET  /api/budgets — list budgets
 * POST /api/budgets — create budget
 */
export default function handler(req, res) {
  if (req.method === "GET") return res.status(200).json([]);
  if (req.method === "POST") return res.status(201).json({ id: `local_${Date.now()}`, ...req.body, status: "draft", items: [] });
  res.status(405).json({ error: "Method not allowed" });
}
