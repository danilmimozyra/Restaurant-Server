[README.md](https://github.com/user-attachments/files/34620357/README.md)
# Restaurant Server

Malý server v Node.js, který hraje roli **restaurace** v systému restaurace ↔ kurýr.

- Přijme objednávku a přes HTTP ji předá samostatné **kurýrní službě**.
- Kurýr posílá změny stavu zpátky přes **podepsaný webhook** (HMAC-SHA256).
- Stránka v prohlížeči ukazuje všechny objednávky a jejich stav a **průběžně se aktualizuje přes WebSocket**.

> Kurýrní služba **není součástí tohoto repozitáře**. Pro celý tok potřebuješ běžící kurýrní server, který dodržuje pravidla popsaná v sekci [Kontrakt kurýra](#kontrakt-kurýra).

---

## Obsah

- [Jak to funguje](#jak-to-funguje)
- [Požadavky](#požadavky)
- [Instalace](#instalace)
- [Konfigurace (`.env`)](#konfigurace-env)
- [Spuštění](#spuštění)
- [Použití](#použití)
- [Popis API](#popis-api)
- [Kontrakt kurýra](#kontrakt-kurýra)
- [Testování bez kurýra](#testování-bez-kurýra)
- [Struktura projektu](#struktura-projektu)
- [Omezení](#omezení)
- [Řešení potíží](#řešení-potíží)

---

## Jak to funguje

```
 klient (curl, aplikace…)   Restaurant Server                      Kurýrní služba
        │                          │                                      │
        │  POST /order {id}        │                                      │
        │─────────────────────────▶│  POST /order {id, callbackURL}       │
        │                          │─────────────────────────────────────▶│
        │                          │◀──────────────── 202 Accepted ───────│
        │◀──────── 202 ────────────│  orders[id] = "Accepted"             │
        │                          │  → rozeslání přes WebSocket          │
        │                          │                                      │
        │                          │  POST /update  (X-Signature: HMAC)   │
        │                          │◀─────────────────────────────────────│
        │                          │  ověří podpis, zahodí duplicity      │
        │                          │  orders[id] = status                 │
        │                          │  → rozeslání přes WebSocket          │
        │                          │─────────────── 200 OK ──────────────▶│

 prohlížeč (http://localhost:3001) ◀── WebSocket: {"type":"orders", "orders": {...}}
```

1. **Vytvoření objednávky.** Klient pošle `POST /order` s `id` objednávky. Server ji předá kurýrovi na `http://COURIER_HOST:COURIER_PORT/order` a přidá `callbackURL` (`http://RESTAURANT_HOST:PORT/update`), aby kurýr věděl, kam posílat změny.
2. **Přijetí.** Objednávka se uloží **jen tehdy, když kurýr odpoví `202 Accepted`**. Její stav je pak `"Accepted"`. Stavový kód od kurýra server vrátí klientovi beze změny. Když kurýr není dostupný, klient dostane `502`.
3. **Změny stavu (webhook).** Kurýr volá `POST /update` s tělem `{ event_id, id, status }` a hlavičkou `X-Signature`. Server:
    - ověří podpis: HMAC-SHA256 z **původního těla požadavku** se `SHARED_SECRET`, poslaný jako 64 hex znaků a porovnaný v konstantním čase (`timingSafeEqual`). Při chybném podpisu odpoví `401`;
    - zkontroluje, že `event_id`, `id` a `status` jsou neprázdné řetězce. Jinak odpoví `400`;
    - `event_id`, které už jednou zpracoval, ignoruje a odpoví `200`, takže opakované pokusy kurýra nic nerozbijí (idempotence);
    - uloží nový stav.
4. **Živý přehled.** Každá změna se rozešle všem připojeným WebSocket klientům. Stránka ve složce `public/` z ní vykreslí tabulku ID objednávky a stavu. Nově připojený prohlížeč dostane aktuální stav hned.

Všechna data jsou jen **v paměti**. Restart serveru všechny objednávky smaže.

---

## Požadavky

| Co | Verze |
|---|---|
| [Node.js](https://nodejs.org/) | **20.12+** nebo **21.7+**, protože server používá `process.loadEnvFile()`. Doporučená je Node 22 LTS nebo novější. |
| npm | instaluje se spolu s Node.js |
| Kurýrní služba | potřeba pro celý tok (viz [Kontrakt kurýra](#kontrakt-kurýra)) |

Závislosti: [`express`](https://expressjs.com/) 5 (HTTP server, JSON, statické soubory) a [`ws`](https://github.com/websockets/ws) 8 (WebSocket server).

---

## Instalace

```bash
git clone https://github.com/danilmimozyra/Restaurant-Server.git
cd Restaurant-Server
npm install
```

---

## Konfigurace (`.env`)

Server čte soubor `.env` ze složky, ve které ho spouštíš. **Ten soubor musí existovat**, jinak `process.loadEnvFile()` při startu spadne. `.env` je v `.gitignore`, takže si ho musíš vytvořit sám:

```env
# Port a rozhraní, na kterém restaurační server poslouchá
PORT=3001
HOST=0.0.0.0

# Adresa, na které KURÝR najde tento server (z ní vznikne callbackURL)
RESTAURANT_HOST=localhost

# Adresa kurýrní služby
COURIER_HOST=localhost
COURIER_PORT=3000

# Sdílené tajemství pro podpis webhooku. U kurýra MUSÍ být stejné
SHARED_SECRET=zmen-me-na-dlouhy-nahodny-retezec
```

| Proměnná | Povinná | Výchozí | Význam |
|---|---|---|---|
| `PORT` | ne | `3001` | Port restauračního serveru (HTTP i WebSocket běží na stejném) |
| `HOST` | ne | `0.0.0.0` | Rozhraní, na kterém server poslouchá (`0.0.0.0` = všechna, dostupné i z místní sítě) |
| `RESTAURANT_HOST` | **ano** | – | Hostname nebo IP, na které kurýr restauraci najde. Použije se v `callbackURL` |
| `COURIER_HOST` | **ano** | – | Hostname nebo IP kurýrní služby |
| `COURIER_PORT` | ne | `3000` | Port kurýrní služby |
| `SHARED_SECRET` | **ano** | – | Tajemství HMAC pro webhooky. Když chybí, server se nespustí |

Vygenerování silného tajemství:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Běh na dvou počítačích:** když kurýr běží na jiném počítači, nastav `RESTAURANT_HOST` na IP tohoto počítače v místní síti (např. `192.168.1.20`), **ne** `localhost`. Jinak bude kurýr posílat webhooky sám sobě. Když `RESTAURANT_HOST` nebo `COURIER_HOST` vynecháš, server se sice spustí, ale v adresách bude `undefined` a komunikace nebude fungovat.

---

## Spuštění

V `package.json` chybí skript `npm start`, server se proto spouští přímo:

```bash
node server.js
```

Očekávaný výpis:

```
Restaurant server listening on 0.0.0.0:3001
```

Pak v prohlížeči otevři **http://localhost:3001**. Stránka by měla ukázat `Connected` a tabulku objednávek, ze začátku prázdnou.

Při vývoji se hodí vestavěný automatický restart v Node:

```bash
node --watch server.js
```

---

## Použití

### 1. Otevři přehled

`http://localhost:3001`: tabulka se obnovuje sama, stránku není potřeba načítat znovu.

### 2. Vytvoř objednávku

Přehled nemá formulář. Objednávky se vytvářejí přes API:

```bash
curl -i -X POST http://localhost:3001/order \
  -H "Content-Type: application/json" \
  -d '{"id": "order-1"}'
```

- `202 Accepted`: kurýr objednávku přijal a v tabulce se objeví se stavem `Accepted`.
- Jiný stavový kód: to, co vrátil kurýr. Objednávka se **neuloží**.
- `502 Bad Gateway`: kurýr není dostupný (neběží, nebo je špatně `COURIER_HOST`/`COURIER_PORT`).

### 3. Sleduj změnu stavu

Jak kurýr posílá webhooky, mění se stav objednávky v tabulce (např. `Picked up` → `Delivered`; konkrétní hodnoty určuje kurýr).

### 4. Zjisti aktuální stav

```bash
curl http://localhost:3001/orders
```

```json
{ "order-1": "Delivered" }
```

---

## Popis API

### `POST /order`

Vytvoří objednávku a předá ji kurýrovi.

**Tělo požadavku**

```json
{ "id": "order-1" }
```

**Odpovědi**

| Stav | Význam |
|---|---|
| `202` | Kurýr objednávku přijal, uloží se se stavem `Accepted` |
| jiný | Stav vrácený kurýrem. Objednávka se neuloží |
| `502` | Kurýrní služba není dostupná |

### `POST /update` (webhook pro kurýra)

Přijme změnu stavu objednávky.

**Hlavičky**

| Hlavička | Hodnota |
|---|---|
| `Content-Type` | `application/json` |
| `X-Signature` | HMAC-SHA256 z původního těla se `SHARED_SECRET`, 64 hex znaků |

**Tělo požadavku**

```json
{ "event_id": "evt-123", "id": "order-1", "status": "Delivered" }
```

**Odpovědi**

| Stav | Význam |
|---|---|
| `200` | Změna uložena, nebo šlo o duplicitní `event_id`, které se ignorovalo |
| `400` | `event_id`, `id` nebo `status` chybí nebo nejde o neprázdný řetězec |
| `401` | Chybějící nebo neplatný podpis |

### `GET /orders`

Vrátí všechny objednávky jako objekt `{ "<id>": "<stav>" }`.

### `GET /`

Statická stránka přehledu ze složky `public/`.

### WebSocket (`ws://localhost:3001`)

Stejný port jako HTTP. Hned po připojení a pak po každé změně server pošle:

```json
{ "type": "orders", "orders": { "order-1": "Accepted" } }
```

Server pokaždé posílá **celý** stav, ne jen změnu.

---

## Kontrakt kurýra

Kurýrní služba, která má s tímto serverem spolupracovat, musí:

1. **Přijímat `POST /order`** na `http://COURIER_HOST:COURIER_PORT/order` s tělem `{ "id": "order-1", "callbackURL": "http://RESTAURANT_HOST:PORT/update" }` a když objednávku přijme, odpovědět **`202 Accepted`**.
2. **Posílat změny** na `callbackURL` jako `POST` s JSON tělem `{ event_id, id, status }`, kde jsou všechny tři hodnoty řetězce:
    - `event_id` je pro každou událost jedinečné. Opakovaný pokus o stejnou událost má stejné `event_id`;
    - `id` odpovídá ID objednávky;
    - `status` je libovolný text, přehled ho ukáže tak, jak je.
3. **Podepisovat každou změnu:** `X-Signature` = `hex(HMAC_SHA256(SHARED_SECRET, puvodni_telo))`, spočítané **přesně z bajtů**, které posílá. Když se tělo po podepsání znovu převede na JSON (jiné mezery, pořadí klíčů), ověření selže.

Ukázka podpisu v Node.js (na straně kurýra):

```js
const crypto = require("crypto");

const body = JSON.stringify({ event_id: "evt-1", id: "order-1", status: "Delivered" });
const signature = crypto.createHmac("sha256", process.env.SHARED_SECRET).update(body).digest("hex");

await fetch(callbackURL, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Signature": signature },
  body,
});
```

---

## Testování bez kurýra

### Simulace webhooku z terminálu

Bez kurýra vrací `POST /order` jen `502` a nic se neuloží. Webhook, kontrolu podpisu i živý přehled si ale můžeš vyzkoušet sám, když požadavek podepíšeš přes `openssl`:

```bash
SECRET="zmen-me-na-dlouhy-nahodny-retezec"   # stejná hodnota jako v .env
BODY='{"event_id":"evt-1","id":"order-1","status":"Delivered"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -i -X POST http://localhost:3001/update \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
```

- První volání: `200` a v přehledu se objeví `order-1: Delivered`.
- Stejné `event_id` znovu: `200` a server do logu napíše `Duplicate event ignored`.
- Změněné `BODY` se starým podpisem, nebo špatné tajemství: `401`.

### Jednoduchý falešný kurýr

Pro vyzkoušení celého toku včetně `POST /order` ulož tohle jako `mock-courier.js` (mimo repozitář nebo do testovací složky) a spusť přes `SHARED_SECRET=... node mock-courier.js`. Přijme objednávku a s odstupem pár sekund pošle dvě podepsané změny:

```js
const http = require("http");
const crypto = require("crypto");

const SECRET = process.env.SHARED_SECRET;

http
  .createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/order") return res.writeHead(404).end();

    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const { id, callbackURL } = JSON.parse(raw);
      res.writeHead(202).end();

      ["Picked up", "Delivered"].forEach((status, i) => {
        setTimeout(() => {
          const body = JSON.stringify({ event_id: crypto.randomUUID(), id: String(id), status });
          const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
          fetch(callbackURL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Signature": sig },
            body,
          }).catch((e) => console.error(e.message));
        }, (i + 1) * 3000);
      });
    });
  })
  .listen(3000, () => console.log("Mock courier on :3000"));
```

---

## Struktura projektu

```
Restaurant-Server/
├── server.js          # HTTP + WebSocket server: /order, /update, /orders, rozesílání
├── public/
│   ├── index.html     # Přehled (tabulka objednávek)
│   └── client.js      # WebSocket klient, vykresluje tabulku
├── package.json       # Závislosti: express, ws
├── package-lock.json
└── .gitignore         # node_modules/, .env
```

---

## Omezení

Projekt je ukázka nebo školní prototyp, ne kód pro ostrý provoz:

- **Žádné trvalé ukládání.** Objednávky i zpracovaná `event_id` jsou jen v paměti a po restartu zmizí.
- **`processedEvents` pořád roste.** Množina zpracovaných událostí se nikdy nečistí, s každým webhookem je větší.
- **`POST /order` nic nekontroluje.** `id` se neověřuje (může chybět nebo se opakovat) a existující objednávka se přepíše.
- **Žádné přihlášení** u `POST /order`, `GET /orders` ani u WebSocketu. Kdo se dostane na port, může objednávky vytvářet i číst.
- **Jen HTTP.** `callbackURL` i adresa kurýra mají napevno `http://`. Ve veřejné síti dej server za HTTPS (reverzní proxy).
- **WebSocket se sám znovu nepřipojí.** Po výpadku spojení stránka ukáže `Disconnected` a je potřeba ji načíst znovu.
- **Žádné testy.** `npm test` jen vypíše chybu.

---

## Řešení potíží

| Příznak | Příčina a řešení |
|---|---|
| `ENOENT: no such file or directory, open '.env'` při startu | Ve složce, odkud spouštíš `node`, chybí `.env`. Vytvoř ho (viz [Konfigurace](#konfigurace-env)) |
| `TypeError: process.loadEnvFile is not a function` | Moc stará verze Node.js. Nainstaluj 20.12+ (doporučená 22 LTS) |
| `Error: SHARED_SECRET is not configured` | V `.env` chybí `SHARED_SECRET` |
| `POST /order` vrací `502` | Kurýr neběží, nebo je špatně `COURIER_HOST`/`COURIER_PORT` |
| Objednávka se nikdy neuloží | Kurýr odpovídá jinak než `202` |
| Webhook vrací `401` | `SHARED_SECRET` se u restaurace a kurýra liší, nebo kurýr podepisuje jiné tělo, než posílá |
| Webhook vrací `400` | `event_id`, `id` nebo `status` chybí nebo není řetězec (číselné `id` neprojde) |
| Kurýr nedokáže doručit webhooky | Špatný `RESTAURANT_HOST` (např. `localhost`, když je kurýr na jiném počítači) nebo firewall na `PORT` |
| `EADDRINUSE` | `PORT` je obsazený. Změň ho v `.env` nebo ukonči druhý proces |
| Přehled ukazuje `Disconnected` | Server neběží nebo se restartoval. Načti stránku znovu |
