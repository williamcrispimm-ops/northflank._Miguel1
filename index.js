import express from 'express';
import morgan from 'morgan';
import multer from 'multer';
import fetch from 'node-fetch';
import AWS from 'aws-sdk';

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Basic middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('tiny'));

// CORS (very permissive by default)
app.use((req, res, next) => {
  const allowed = (process.env.ALLOWED_ORIGINS || '*');
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health & alive
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

app.get('/alive', (req, res) => {
  res.json({
    ok: true,
    service: 'miguel-api',
    time: new Date().toISOString(),
    services: [] // você pode popular com checagens externas (n8n, neon etc.)
  });
});

// R2 (S3 compatible) client (optional)
const r2Configured = process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET;
let s3 = null;
if (r2Configured) {
  s3 = new AWS.S3({
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region: 'auto'
  });
}

// Simple upload to R2
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!r2Configured) return res.status(400).json({ ok: false, error: 'R2 is not configured' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'file is required (multipart field name "file")' });
    const key = `${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`;
    await s3.putObject({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
      ACL: 'private'
    }).promise();
    res.json({ ok: true, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'upload_failed' });
  }
});

// Telegram webhook (normaliza e repassa para n8n, se quiser)
app.post('/webhook/telegram', async (req, res) => {
  try {
    // TODO: validações básicas (ex.: checar token no path)
    // Encaminhar para seu n8n (modifique URL abaixo)
    const n8nUrl = process.env.N8N_WEBHOOK_URL; // ex.: https://<n8n-domain>/webhook/telegram
    if (!n8nUrl) return res.status(200).json({ ok: true, skipped: 'no_n8n_url' });

    const fwd = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await fwd.text();
    res.status(200).send(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

// Root
app.get('/', (_req, res) => res.send('Miguel API is running.'));

app.listen(port, () => {
  console.log(`miguel-api listening on :${port}`);
});
