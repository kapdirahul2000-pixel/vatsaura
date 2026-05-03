import express from "express";
import cors from "cors";
import Razorpay from "razorpay";

const KEY_ID = "rzp_test_SkBFMIJSMzC3mb";
const KEY_SECRET = "h7gXrO8evouP5JlNtV0e9Vnl7pU";

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
      amount,
      currency: "INR",
    });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(4000);
