const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

process.loadEnvFile();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";

const RESTAURANT_HOST = process.env.RESTAURANT_HOST;
const COURIER_HOST = process.env.COURIER_HOST;
const COURIER_PORT = Number(process.env.COURIER_PORT || 3000);

const COURIER_URL = `http://${COURIER_HOST}:${COURIER_PORT}/order`;
const CALLBACK_URL = `http://${RESTAURANT_HOST}:${PORT}/update`;

const SHARED_SECRET = process.env.SHARED_SECRET;

if (!SHARED_SECRET) {
  throw new Error("SHARED_SECRET is not configured");
}

const orders = {};
const processedEvents = new Set();

app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer;
    },
  }),
);
app.use(express.static("public"));

function broadcastOrders() {
  const message = JSON.stringify({
    type: "orders",
    orders,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");

  ws.send(
    JSON.stringify({
      type: "orders",
      orders,
    }),
  );

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });
});

app.get("/orders", (req, res) => {
  res.json(orders);
});

app.post("/order", async (req, res) => {
  const { id } = req.body;

  const order = {
    id: id,
    callbackURL: CALLBACK_URL,
  };

  try {
    const response = await fetch(COURIER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(order),
    });

    console.log("Order sent to courier:", order);
    console.log("Courier response:", response.status);

    if (response.status === 202) {
      orders[id] = "Accepted";
      broadcastOrders();
    }

    res.sendStatus(response.status);
  } catch (error) {
    console.error("Failed to contact courier:", error.message);
    res.sendStatus(502);
  }
});

app.post("/update", (req, res) => {
  const signature = (req.get("X-Signature") || "").trim();

  const expectedSignature = crypto
    .createHmac("sha256", SHARED_SECRET)
    .update(req.rawBody)
    .digest();

  const receivedSignature = Buffer.from(signature, "hex");

  if (
    !/^[0-9a-f]{64}$/i.test(signature) ||
    receivedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    console.log("Webhook rejected: Invalid signature");
    return res.sendStatus(401);
  }

  const { event_id, id, status } = req.body;

  if (
    typeof event_id !== "string" ||
    !event_id.trim() ||
    typeof id !== "string" ||
    !id.trim() ||
    typeof status !== "string" ||
    !status.trim()
  ) {
    return res.sendStatus(400);
  }

  if (processedEvents.has(event_id)) {
    console.log(`Duplicate event ignored: ${event_id}`);
    return res.sendStatus(200);
  }

  processedEvents.add(event_id);

  orders[id] = status;

  console.log(`Order ${id}: ${status}`);

  broadcastOrders();

  res.sendStatus(200);
});

server.listen(PORT, HOST, () => {
  console.log(`Restaurant server listening on ${HOST}:${PORT}`);
});
