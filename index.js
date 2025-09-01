import express from 'express';
import os from 'os';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SERVICE_NAME = process.env.SERVICE_NAME || 'miguel-core';
const APP_VERSION = process.env.APP_VERSION || '1.0.0';
const N8N_SISTEMA_URL = process.env.N8N_SISTEMA_URL || '';
const N8N_USUARIO_URL = process.env.N8N_USUARIO_URL || '';

// Alive & health
app.get('/alive', (_req, res) => res.send('ok'));
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

// Status detalhado
app.get('/status', (_req, res) => {
  res.json({
    ok: true,
    name: SERVICE_NAME,
    version: APP_VERSION,
    uptime_s: Math.round(process.uptime()),
    node: process.version,
    host: os.hostname(),
    timestamp: new Date().toISOString()
  });
});

// --- BLOCO R1 ---
app.get('/r1/status', (_req, res) => res.json({ ok: true, msg: 'r1 up' }));
app.post('/r1/sync', async (_req, res) => {
  if (!N8N_SISTEMA_URL) return res.status(400).json({ ok: false, error: 'N8N_SISTEMA_URL vazio' });
  try {
    const r = await fetch(`${N8N_SISTEMA_URL}/webhook/sync`, { method: 'POST' });
    res.json({ ok: r.ok, status: r.status });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- BLOCO R2 ---
app.get('/r2/status', (_req, res) => res.json({ ok: true, msg: 'r2 up' }));
app.post('/r2/export', async (_req, res) => {
  if (!N8N_USUARIO_URL) return res.status(400).json({ ok: false, error: 'N8N_USUARIO_URL vazio' });
  try {
    const r = await fetch(`${N8N_USUARIO_URL}/webhook/export`, { method: 'POST' });
    res.json({ ok: r.ok, status: r.status });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Root
app.get('/', (_req, res) => res.send('Miguel Core — Alive + R1 + R2'));

app.listen(PORT, () => console.log(`Core listening on :${PORT}`));
