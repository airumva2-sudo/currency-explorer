# Currency Explorer

A web app for exploring live exchange rates. Choose a base currency (for example USD or RWF) and see its rate against every other currency, convert an amount with a Convert button, **search** by code or name, **sort** by code, name or rate and mark **favourites**.

**Who it helps:** travellers, international students, freelancers paid in different currencies, people sending money abroad and whoever needs to see the value of their money in other currencies.

## Live deployment

| Role | Address |
|---|---|
| **Load balancer (Lb01), use this one** | `http://18.133.246.239` |
| Web01 | `http://3.10.140.187` |
| Web02 | `http://18.170.225.28` |

## Features

- Live rates for over 160 currencies, from ExchangeRate-API
- **Search** by code or name (e.g. `rwf`, `gcd`, `euro`)
- **Sort** by code, name or rate (from high to low or low to high)
- **Converter**: choose an amount, from and to currency
- Clear error messages with a Retry button
- Rates cached on the server, with saved rates shown if the API is down
- API key kept on the server, never in the browser or GitHub

## API and credit

- **API:** [ExchangeRate-API](https://www.exchangerate-api.com). Rates update once a day. Free plan: 1,500 requests per month.
- **Attribution:** Rates By Exchange Rate API (also in the app's footer).
- **Other credits:** Node.js, MDN Web Docs (`Intl.DisplayNames`), Nginx, HAProxy, systemd.

## Security 

- The API key is only in `.env` on each server. `.env` is in `.gitignore`, and only `.env.example` is on GitHub.
- The browser only talks to our own server, which checks input and times out slow requests.
- The frontend uses `textContent` only, so API data can't inject HTML.

## Error handling

| Problem | What happens |
|---|---|
| API down, slow or rate-limited | Last saved rates are shown with a notice or a clear error |
| Server unreachable or slow | "Can't reach the server" message with Retry |
| Invalid amount | "Enter a valid amount" message |
| No search results | Friendly message in the table |

## Run locally

Needs Node.js 18 or newer.
```bash
git clone https://github.com/airumva2-sudo/currency-explorer.git
cd currency-explorer
cp .env.example .env
node server.js
```

Open **http://localhost:3000**. To use an API key, put `EXCHANGE_API_KEY=your_key_here` in `.env` and restart. With no key it uses the keyless endpoint.

## Deployment 

```
Browser --> Lb01 (HAProxy) --> Web01 (Nginx --> Node :3000)
--> Web02 (Nginx --> Node :3000)
```

**On Web01 and Web02:**
```bash
sudo apt update && sudo apt install -y nginx git curl
sudo mkdir -p /opt/currency-explorer && sudo chown $USER /opt/currency-explorer
git clone https://github.com/airumva2-sudo/currency-explorer.git /opt/currency-explorer
cd /opt/currency-explorer
cp .env.example .env && nano .env
```

Run the app as a service by creating `/etc/systemd/system/currency.service`:
```ini
[Unit]
Description=Currency Explorer
After=network.target

[Service]
WorkingDirectory=/opt/currency-explorer
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now currency
curl localhost:3000/health
```

Put Nginx in front, in `/etc/nginx/sites-available/currency`:
```nginx
server {
    listen 80 default_server;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```
```bash
sudo ln -sf /etc/nginx/sites-available/currency /etc/nginx/sites-enabled/currency
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## Load balancer (Lb01)

```bash
sudo apt update && sudo apt install -y haproxy
sudo nano /etc/haproxy/haproxy.cfg
```
Add to the end of the file:
```haproxy
frontend http_front
     bind *:80
    mode http
    default_backend currency_back

backend currency_back
    mode http
    balance roundrobin
    option redispatch
    retries 3
    option httpchk GET /health
    http-check expect status 200
    server web01 3.10.140.187:80 check inter 2s fall 2 rise 2
    server web02 18.170.225.28:80 check inter 2s fall 2 rise 2
```

```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg
sudo systemctl restart haproxy
```
Round robin alternates between the servers. The health check (`/health`) stops traffic going to a server that has failed.

## Testing

**Load sharing** (PowerShell, prints which server answered):
```powershell
1..10 | ForEach-Object {(Invoke-WebRequest -UseBasicParsing http://18.133.246.239/health).Headers['X-Served-By']}
```
Expected: `web01` and `web02` alternating.

**Evidence:**
```
```

**Failover:** run `sudo systemctl stop currency` on Web01. All answers should now be `web02` and the app keeps working. Start it again with `sudo systemctl start currency`.

**Evidence:**
```
```
**Demonstration video link**
https://youtu.be/hQpZW8YHpes                           
