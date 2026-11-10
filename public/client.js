const ordersTable = document.querySelector("#orders");
const connectionStatus = document.querySelector("#connectionStatus");

const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${protocol}//${location.host}`);

const orderIdInput = document.querySelector("#orderId");
const sendOrderButton = document.querySelector("#sendOrder");
const orderResult = document.querySelector("#orderResult");

ws.addEventListener("open", () => {
  connectionStatus.textContent = "Connected";
});

ws.addEventListener("close", () => {
  connectionStatus.textContent = "Disconnected";
});

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case "orders":
      renderOrders(message.orders);
      break;
  }
});

function renderOrders(orders) {
  ordersTable.replaceChildren();

  for (const [id, status] of Object.entries(orders)) {
    const row = document.createElement("tr");

    const idCell = document.createElement("td");
    idCell.textContent = id;

    const statusCell = document.createElement("td");
    statusCell.textContent = status;

    row.append(idCell, statusCell);
    ordersTable.appendChild(row);
  }
}

sendOrderButton.addEventListener("click", async () => {
  const id = orderIdInput.value.trim();

  if (!id) {
    orderResult.textContent = "Please enter an order ID.";
    return;
  }

  sendOrderButton.disabled = true;
  orderResult.textContent = "Sending order...";

  try {
    const response = await fetch("/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });

    if (response.status === 202) {
      orderResult.textContent = `Order ${id} accepted.`;
      orderIdInput.value = "";
    } else {
      orderResult.textContent = `Failed to send order (HTTP ${response.status}).`;
    }
  } catch (error) {
    orderResult.textContent = `Request failed: ${error.message}`;
  } finally {
    sendOrderButton.disabled = false;
  }
});
