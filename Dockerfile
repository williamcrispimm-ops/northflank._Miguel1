# Dockerfile (Miguel API)
FROM node:20-alpine

WORKDIR /app

# Instala só o necessário para produção
COPY package*.json ./

# Se existir package-lock, usa npm ci; senão, cai pra npm install
RUN npm ci --only=production || npm install --omit=dev

# Copia o restante do projeto
COPY . .

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Healthcheck bate no /healthz
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "index.js"]
