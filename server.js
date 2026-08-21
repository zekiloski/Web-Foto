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

// Admin: generate new QR session
app.get('/api/nueva-sesion', async (req, res) => {
  const sessionId = uuidv4();
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const uploadUrl = `${baseUrl}/upload/${sessionId}`;
  const qrDataUrl = await QRCode.toDataURL(uploadUrl, { width: 300 });
  res.json({ sessionId, uploadUrl, qr: qrDataUrl });
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
