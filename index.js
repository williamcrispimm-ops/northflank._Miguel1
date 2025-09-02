import express from 'express';
import crypto from 'node:crypto';
import fetch from 'node-fetch';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const app = express();
app.use(express.json());

// ---------- ENV ----------
const PORT = process.env.PORT || 3000;
const SERVICE_NAME = process.env.SERVICE_NAME || 'miguel-core';
const APP_VERSION = process.env.APP_VERSION || '1.0.0';

const N8N_SISTEMA_URL = process.env.N8N_SISTEMA_URL || '';  // R1
const N8N_USUARIO_URL = process.env.N8N_USUARIO_URL || '';  // R2

const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_BUCKET = process.env.R2_BUCKET || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';

const TZ = process.env.TIMEZONE || 'America/Sao_Paulo';
const SLEEP_START = process.env.SLEEP_START || '02:00';
const SLEEP_END   = process.env.SLEEP_END   || '07:00';

// opcional: avisos por Telegram
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID   = process.env.TG_CHAT_ID || '';

// ---------- R2 CLIENT ----------
const s3 =
  R2_ENDPOINT && R2_BUCKET
    ? new S3Client({
        region: 'auto',
        endpoint: R2_ENDPOINT,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
      })
    : null;

// ---------- HELPERS ----------
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map((v) => parseInt(v, 10));
  return h * 60 + m;
};

const nowMinutesInTZ = () => {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  });
  const [h, m] = fmt.format(new Date()).split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
};

function isSleeping() {
  const start = toMinutes(SLEEP_START);
  const end = toMinutes(SLEEP_END);
  const now = nowMinutesInTZ();
  // janela pode atravessar meia-noite (ex.: 22:00–06:00)
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

async function sendTelegram(msg) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg }),
    });
  } catch {}
}

async function cacheToR2(kind, webhookUrl, payload) {
  if (!s3) throw new Error('R2 não configurado');
  const key = `queue/${kind}/${new Date().toISOString()}_${crypto.randomUUID()}.json`;
  const body = JSON.stringify({ webhookUrl, payload });
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    })
  );
  return key;
}

const streamToString = (stream) =>
  new Promise((resolve, reject) => {
    let data = '';
    stream.on('data', (c) => (data += c));
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });

async function flushQueue(prefix = 'queue/') {
  if (!s3) throw new Error('R2 não configurado');
  let ContinuationToken;
  const results = [];

  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken,
      })
    );
    const items = list.Contents || [];
    for (const it of items) {
      try {
        const obj = await s3.send(
          new GetObjectCommand({ Bucket: R2_BUCKET, Key: it.Key })
        );
        const str = await streamToString(obj.Body);
        const { webhookUrl, payload } = JSON.parse(str || '{}');

        const r = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!r.ok) throw new Error(`POST ${webhookUrl} -> ${r.status}`);

        await s3.send(
          new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: it.Key })
        );
        results.push({ key: it.Key, ok: true });
      } catch (e) {
        results.push({ key: it.Key, ok: false, error: String(e) });
      }
    }
    ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (ContinuationToken);

  return results;
}

// ---------- ROTAS BÁSICAS ----------
app.get('/alive', (_req, res) => res.send('ok'));
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.get('/status', (_req, res) =>
  res.json({
    ok: true,
    name: SERVICE_NAME,
    version: APP_VERSION,
    uptime: Math.round(process.uptime()),
    node: process.version,
    sleep: {
      active: isSleeping(),
      start: SLEEP_START,
      end: SLEEP_END,
      tz: TZ,
    },
    timestamp: new Date().toISOString(),
  })
);

// ---------- BLOCO R1 ----------
app.get('/r1/status', (_req, res) =>
  res.json({ ok: true, msg: 'r1 up' })
);

app.post('/r1/sync', async (req, res) => {
  if (!N8N_SISTEMA_URL) {
    return res.status(400).json({ ok: false, error: 'N8N_SISTEMA_URL vazio' });
  }

  // dormindo? vai pro R2
  if (isSleeping()) {
    try {
      const key = await cacheToR2('r1', `${N8N_SISTEMA_URL}/webhook/sync`, req.body);
      await sendTelegram('🌙 Miguel dormindo: pedido de R1 guardado no cache.');
      return res.json({
        ok: true,
        sleeping: true,
        cachedKey: key,
        msg: 'Estou dormindo agora, guardei sua mensagem e vou processar quando acordar.',
      });
    } catch (e) {
      return res.status(500).json({ ok: false, sleeping: true, error: String(e) });
    }
  }

  // acordado? envia pro n8n
  try {
    const r = await fetch(`${N8N_SISTEMA_URL}/webhook/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const data = await r.text();
    return res.status(r.status).type('application/json').send(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- BLOCO R2 ----------
app.get('/r2/status', (_req, res) =>
  res.json({ ok: true, msg: 'r2 up' })
);

app.post('/r2/export', async (req, res) => {
  if (!N8N_USUARIO_URL) {
    return res.status(400).json({ ok: false, error: 'N8N_USUARIO_URL vazio' });
  }

  if (isSleeping()) {
    try {
      const key = await cacheToR2('r2', `${N8N_USUARIO_URL}/webhook/export`, req.body);
      await sendTelegram('🌙 Miguel dormindo: pedido de R2 guardado no cache.');
      return res.json({
        ok: true,
        sleeping: true,
        cachedKey: key,
        msg: 'Estou dormindo agora, guardei sua mensagem e vou processar quando acordar.',
      });
    } catch (e) {
      return res.status(500).json({ ok: false, sleeping: true, error: String(e) });
    }
  }

  try {
    const r = await fetch(`${N8N_USUARIO_URL}/webhook/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const data = await r.text();
    return res.status(r.status).type('application/json').send(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- FLUSH MANUAL (chamar ao acordar, ou via cron) ----------
app.post('/flush', async (_req, res) => {
  try {
    const result = await flushQueue('queue/');
    res.json({ ok: true, flushed: result });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ---------- ROOT ----------
app.get('/', (_req, res) => res.send('Miguel Core — Alive + R1 + R2'));
app.listen(PORT, () => console.log(`Core listening on :${PORT}`));
