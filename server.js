const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const os = require('os');

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) return alias.address;
    }
  }
  return 'localhost';
}
const LOCAL_IP = getLocalIP();

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1); // Hostinger corre la app detrás de un proxy que termina el HTTPS

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Ensure data dir exists (personalización)
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const configPath = path.join(dataDir, 'config.json');

// Sesión fija: un único QR que se reutiliza para cualquier evento
const sessionPath = path.join(dataDir, 'session.json');
function getMainSessionId() {
  if (fs.existsSync(sessionPath)) {
    try { return JSON.parse(fs.readFileSync(sessionPath, 'utf8')).sessionId; }
    catch { /* si el archivo está corrupto, se regenera abajo */ }
  }
  const sessionId = uuidv4();
  fs.writeFileSync(sessionPath, JSON.stringify({ sessionId }));
  return sessionId;
}
const MAIN_SESSION_ID = getMainSessionId();

// Multer: store files in uploads/<sessionId>/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsDir, req.params.sessionId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.get('/', (req, res) => res.redirect('/admin.html'));

// Personalización: leer configuración guardada
app.get('/api/config', (req, res) => {
  if (!fs.existsSync(configPath)) return res.json({});
  try { res.json(JSON.parse(fs.readFileSync(configPath, 'utf8'))); }
  catch { res.json({}); }
});

// Personalización: guardar configuración (título, logo, fondo)
app.post('/api/config', express.json({ limit: '15mb' }), (req, res) => {
  const { titulo, logo, bg_img, bg_opac, bg_pos } = req.body;
  fs.writeFileSync(configPath, JSON.stringify({ titulo, logo, bg_img, bg_opac, bg_pos }));
  res.json({ ok: true });
});

// Admin: obtener la sesión fija (mismo QR siempre, para cualquier evento)
app.get('/api/sesion', async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const uploadUrl = `${baseUrl}/upload/${MAIN_SESSION_ID}`;
  const qrDataUrl = await QRCode.toDataURL(uploadUrl, { width: 300 });
  res.json({ sessionId: MAIN_SESSION_ID, uploadUrl, qr: qrDataUrl });
});

// Admin: vaciar las fotos de la sesión fija (para arrancar un evento nuevo sin cambiar el QR)
app.post('/api/sesion/vaciar', (req, res) => {
  const dir = path.join(uploadsDir, MAIN_SESSION_ID);
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
  }
  res.json({ ok: true });
});

// List photos for a session
app.get('/api/fotos/:sessionId', (req, res) => {
  const dir = path.join(uploadsDir, req.params.sessionId);
  if (!fs.existsSync(dir)) return res.json({ fotos: [] });
  const files = fs.readdirSync(dir).map(f => `/uploads/${req.params.sessionId}/${f}`);
  res.json({ fotos: files });
});

// Delete photos
app.delete('/api/fotos/:sessionId', express.json(), (req, res) => {
  const { archivos } = req.body; // array de nombres de archivo
  if (!Array.isArray(archivos) || !archivos.length)
    return res.status(400).json({ error: 'Sin archivos' });

  const dir = path.join(uploadsDir, req.params.sessionId);
  let ok = 0, fail = 0;
  archivos.forEach(nombre => {
    // solo el nombre base, sin path traversal
    const safe = path.basename(nombre);
    const full = path.join(dir, safe);
    try { fs.unlinkSync(full); ok++; }
    catch { fail++; }
  });
  res.json({ ok, fail });
});

// Upload photos
app.post('/api/subir/:sessionId', upload.array('fotos', 30), (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'No se recibieron imágenes' });
  res.json({ ok: true, cantidad: req.files.length });
});

// Upload page route
app.get('/upload/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Panel admin: http://localhost:${PORT}/admin.html`);
  console.log(`IP local de red: http://${LOCAL_IP}:${PORT} (para probar en el celular sin desplegar)`);
});
