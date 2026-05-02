export default function handler(req, res) {
  if (req.method === "POST") {
    const { password } = req.body;

    if (password === "Rahul@136200") {
      return res.status(200).json({ success: true });
    }

    return res.status(401).json({ success: false });
  }

  return res.status(405).end();
}