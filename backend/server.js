import express from "express";
import cors from "cors";
import Razorpay from "razorpay";

const KEY_ID = "rzp_test_Skpnql13YPlCrY";
const KEY_SECRET = "aonQpIHw61ojQLibKgxgR8B3";

const razorpay = new Razorpay({
  key_id: KEY_ID,
  key_secret: KEY_SECRET,
});

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
    });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ YEH ADD KIYA HAI (IMPORTANT)
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});