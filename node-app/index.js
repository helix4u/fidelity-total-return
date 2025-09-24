import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { buildPortfolioModel } from './portfolio.js';
import { computePortfolioPerformance } from './performance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const POSITIONS_DIR = path.join(DATA_DIR, 'positions');
for (const d of [UPLOADS_DIR, POSITIONS_DIR]) fs.mkdirSync(d, { recursive: true });

const app = express();
const upload = multer({ dest: UPLOADS_DIR });
const uploadPositions = multer({ dest: POSITIONS_DIR });

function clearCsvs(folder) {
  for (const f of fs.readdirSync(folder)) {
    if (f.endsWith('.csv')) {
      fs.unlinkSync(path.join(folder, f));
    }
  }
}

app.use('/app', express.static(path.join(ROOT, 'frontend')));

app.get('/', (req, res) => {
  const idx = path.join(ROOT, 'frontend', 'index.html');
  if (fs.existsSync(idx)) {
    res.sendFile(idx);
  } else {
    res.status(500).send(`<pre>Frontend missing</pre><p>Support the project on <a href="https://ko-fi.com/gille" target="_blank">Ko-fi</a>.</p>`);
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file || !req.file.originalname.toLowerCase().endsWith('.csv')) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ detail: 'Upload a .csv file' });
  }
  clearCsvs(UPLOADS_DIR, req.file.filename);
  const dest = path.join(UPLOADS_DIR, req.file.originalname);
  fs.renameSync(req.file.path, dest);
  res.json({ ok: true, filename: req.file.originalname, kind: 'activity' });
});

app.post('/upload_positions', uploadPositions.single('file'), (req, res) => {
  if (!req.file || !req.file.originalname.toLowerCase().endsWith('.csv')) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ detail: 'Upload a .csv file' });
  }
  clearCsvs(POSITIONS_DIR, req.file.filename);
  const dest = path.join(POSITIONS_DIR, req.file.originalname);
  fs.renameSync(req.file.path, dest);
  res.json({ ok: true, filename: req.file.originalname, kind: 'positions' });
});

app.post('/clear', (req, res) => {
  clearCsvs(UPLOADS_DIR);
  clearCsvs(POSITIONS_DIR);
  res.json({ ok: true });
});

function readManyCsv(folder) {
  const files = fs.readdirSync(folder).filter(f => f.endsWith('.csv'));
  let rows = [];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(folder, f), 'utf8');
    const lines = txt.split(/\r?\n/);
    const hdrIdx = lines.findIndex(line => /Account Number/i.test(line) && /Description/i.test(line));
    if (hdrIdx === -1) continue;
    const data = lines.slice(hdrIdx).join('\n');
    const parsed = parse(data, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true
    });
    rows = rows.concat(parsed);
  }
  return rows;
}

async function servePortfolio(req, res) {
  const actRows = readManyCsv(UPLOADS_DIR);
  const posRows = readManyCsv(POSITIONS_DIR);
  if (actRows.length === 0 || posRows.length === 0) {
    return res.status(400).json({ detail: 'Upload both an activity CSV and a positions CSV first' });
  }
  console.log(`Computing portfolio for ${actRows.length} activity rows and ${posRows.length} position rows`);
  const model = buildPortfolioModel(actRows, posRows);
  const result = await computePortfolioPerformance(model);
  clearCsvs(UPLOADS_DIR);
  clearCsvs(POSITIONS_DIR);
  res.json(result);
}

function wrapAsync(fn) {
  return (req, res) => {
    console.log(`${req.method} ${req.path}`);
    Promise.resolve(fn(req, res)).catch(err => {
      console.error(`Error during ${req.path}`, err);
      res.status(500).json({ detail: 'Server error' });
    });
  };
}

app.get('/portfolio', wrapAsync(servePortfolio));
app.get('/recalc', wrapAsync(servePortfolio));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Node Total Return server running on ${PORT}`);
  console.log('Support the project at https://ko-fi.com/gille');
});

