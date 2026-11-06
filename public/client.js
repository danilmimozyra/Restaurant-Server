const ordersTable = document.querySelector("#orders");
const connectionStatus = document.querySelector("#connectionStatus");

const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(`${protocol}//${location.host}`);

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
