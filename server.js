const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const USERS_FILE = path.join(__dirname, 'users.json');
const STORAGE_FILE = path.join(__dirname, 'storage.json');

fs.ensureDirSync(UPLOAD_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeJsonSync(USERS_FILE, []);
if (!fs.existsSync(STORAGE_FILE)) fs.writeJsonSync(STORAGE_FILE, { files: [] });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploaded files statically
app.use('/uploads', express.static(UPLOAD_DIR));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname) || mime.extension(file.mimetype) || '';
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB hard limit (adjust if needed)
});

// Helpers
async function readUsers() { return fs.readJson(USERS_FILE); }
async function writeUsers(u) { await fs.writeJson(USERS_FILE, u, { spaces: 2 }); }
async function readStorage() { return fs.readJson(STORAGE_FILE); }
async function writeStorage(s) { await fs.writeJson(STORAGE_FILE, s, { spaces: 2 }); }

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Invalid Authorization header' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Routes
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const users = await readUsers();
  if (users.some(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);
  const user = { id: uuidv4(), email, passwordHash: hash, createdAt: new Date().toISOString() };
  users.push(user);
  await writeUsers(users);
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email } });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const users = await readUsers();
  const user = users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email } });
});

// Get files for user (or all if admin later)
app.get('/api/files', authMiddleware, async (req, res) => {
  const store = await readStorage();
  // Filter to only user's files
  const userFiles = store.files.filter(f => f.ownerId === req.user.id);
  res.json(userFiles);
});

// Upload
app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
  // file saved to UPLOAD_DIR by multer
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const allowed = [
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','video/ogg','audio/mpeg'
  ];
  if (!allowed.includes(req.file.mimetype)) {
    // remove file
    await fs.remove(req.file.path);
    return res.status(400).json({ error: 'Unsupported file type' });
  }

  const publicUrl = `${req.protocol}://${req.get('host')}/uploads/${path.basename(req.file.path)}`;
  const meta = {
    id: path.basename(req.file.path, path.extname(req.file.path)),
    originalName: req.file.originalname,
    filename: path.basename(req.file.path),
    mimeType: req.file.mimetype,
    size: req.file.size,
    url: publicUrl,
    ownerId: req.user.id,
    createdAt: new Date().toISOString()
  };

  const store = await readStorage();
  store.files.push(meta);
  await writeStorage(store);

  res.json({ success: true, file: meta });
});

// Get single file metadata
app.get('/api/files/:id', authMiddleware, async (req, res) => {
  const store = await readStorage();
  const file = store.files.find(f => f.id === req.params.id && f.ownerId === req.user.id);
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.json(file);
});

// Optional: Delete file (owner only)
app.delete('/api/files/:id', authMiddleware, async (req, res) => {
  const store = await readStorage();
  const idx = store.files.findIndex(f => f.id === req.params.id && f.ownerId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const file = store.files[idx];
  // remove disk file
  await fs.remove(path.join(UPLOAD_DIR, file.filename));
  store.files.splice(idx, 1);
  await writeStorage(store);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
