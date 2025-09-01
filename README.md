# Miguel Core

### Alive & Health
- `GET /alive` → "ok"
- `GET /healthz` → `{ "status": "ok" }`
- `GET /status` → informações do serviço

### R1
- `GET /r1/status` → `{ "ok": true, "msg": "r1 up" }`
- `POST /r1/sync` → dispara sync no n8n-sistema

### R2
- `GET /r2/status` → `{ "ok": true, "msg": "r2 up" }`
- `POST /r2/export` → dispara export no n8n-usuario
