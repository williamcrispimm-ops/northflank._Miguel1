FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN RUN npm ci --only=production || npm install --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s   CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "index.js"]
