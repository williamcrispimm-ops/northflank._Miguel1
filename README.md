# Miguel API (Starter)

Endpoints principais:
- `GET /healthz` -> 200 OK
- `GET /alive` -> status simples
- `POST /upload` (multipart field `file`) -> envia para Cloudflare R2 (S3)
- `POST /webhook/telegram` -> repassa payload para o n8n (defina `N8N_WEBHOOK_URL`)

## Rodar local
```bash
cp .env.example .env
npm ci
npm start
```

## Docker local
```bash
docker build -t miguel-api .
docker run -p 3000:3000 --env-file .env miguel-api
```

## Deploy (Northflank)
- Aponte para este repo.
- Porta interna: 3000
- Healthcheck: GET /healthz
- Plano sugerido: nf-compute-10 (0.1 vCPU / 256MB)
