const API = '';

const el = id => document.getElementById(id);
const setMsg = (id, msg) => el(id).textContent = msg;
const show = (id) => el(id).classList.remove('hidden');
const hide = (id) => el(id).classList.add('hidden');

let token = localStorage.getItem('mv_token');
let user = JSON.parse(localStorage.getItem('mv_user') || 'null');

const $loginForm = el('login-form');
const $registerForm = el('register-form');

function setAuthState(loggedIn) {
  if (loggedIn) {
    hide('auth-section');
    show('app-section');
    loadFiles();
  } else {
    show('auth-section');
    show('login-form');
    hide('register-form');
    hide('app-section');
  }
}

if (token && user) {
  setAuthState(true);
} else {
  setAuthState(false);
}

// Toggle register/login
el('show-register').addEventListener('click', (e) => { e.preventDefault(); hide('login-form'); show('register-form'); });
el('show-login').addEventListener('click', (e) => { e.preventDefault(); show('login-form'); hide('register-form'); });

// Register
el('btn-register').addEventListener('click', async () => {
  const email = el('reg-email').value.trim();
  const password = el('reg-password').value;
  setMsg('reg-msg','');
  try {
    const res = await fetch(`${API}/api/register`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email, password })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Register failed');
    token = j.token; user = j.user;
    localStorage.setItem('mv_token', token);
    localStorage.setItem('mv_user', JSON.stringify(user));
    setAuthState(true);
  } catch (err) {
    setMsg('reg-msg', err.message);
  }
});

// Login
el('btn-login').addEventListener('click', async () => {
  const email = el('login-email').value.trim();
  const password = el('login-password').value;
  setMsg('login-msg','');
  try {
    const res = await fetch(`${API}/api/login`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email, password })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Login failed');
    token = j.token; user = j.user;
    localStorage.setItem('mv_token', token);
    localStorage.setItem('mv_user', JSON.stringify(user));
    setAuthState(true);
  } catch (err) {
    setMsg('login-msg', err.message);
  }
});

// Logout
el('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('mv_token'); localStorage.removeItem('mv_user'); token = null; user = null; setAuthState(false);
});

// File selection & validation
let selectedFile = null;
el('file-input').addEventListener('change', async (e) => {
  setMsg('validation-msg', '');
  setMsg('upload-result', '');
  selectedFile = e.target.files[0];
  el('preview').innerHTML = '';
  el('btn-upload').disabled = true;
  if (!selectedFile) return;
  // Allowed types
  const allowed = ['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','audio/mpeg'];
  if (!allowed.includes(selectedFile.type)) {
    setMsg('validation-msg', 'Unsupported file type');
    return;
  }
  // Preview
  if (selectedFile.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(selectedFile);
    el('preview').appendChild(img);
  } else if (selectedFile.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.src = URL.createObjectURL(selectedFile);
    v.controls = true;
    el('preview').appendChild(v);
  } else {
    el('preview').textContent = `File: ${selectedFile.name}`;
  }

  // If > 10MB and image, compress client-side
  if (selectedFile.size > 10 * 1024 * 1024 && selectedFile.type.startsWith('image/')) {
    setMsg('validation-msg', 'Large image detected — compressing to <=10MB (client-side)');
    try {
      const blob = await compressImageToLimit(selectedFile, 10 * 1024 * 1024);
      selectedFile = new File([blob], selectedFile.name, { type: blob.type });
      setMsg('validation-msg', 'Compression done.');
      el('btn-upload').disabled = false;
    } catch (err) {
      setMsg('validation-msg', 'Compression failed: ' + err.message);
    }
  } else if (selectedFile.size > 30 * 1024 * 1024) {
    // for very large files, warn
    setMsg('validation-msg', 'File is large (>30MB). Upload may take long. For video compression, use external tools or server-side ffmpeg.');
    el('btn-upload').disabled = false;
  } else {
    el('btn-upload').disabled = false;
  }
});

async function compressImageToLimit(file, maxBytes) {
  // Returns a Blob compressed to <= maxBytes (approx) by downsizing and lowering quality
  const imgBitmap = await createImageBitmap(file);
  let [w,h] = [imgBitmap.width, imgBitmap.height];
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Start from quality 0.9 and reduce
  let quality = 0.9;
  // If very large dimensions, scale down
  const maxDim = Math.max(w,h);
  if (maxDim > 3000) {
    const scale = 3000 / maxDim;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  } else if (maxDim > 2000) {
    const scale = 2000 / maxDim;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  while (true) {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(imgBitmap, 0, 0, w, h);
    // try blob
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Compression returned null');
    if (blob.size <= maxBytes || quality < 0.25) return blob;
    // reduce size by decreasing quality and (every few steps) reduce dimensions
    quality -= 0.15;
    if (quality < 0.5) {
      w = Math.round(w * 0.85);
      h = Math.round(h * 0.85);
    }
  }
}

// Upload with progress (XHR)
el('btn-upload').addEventListener('click', async () => {
  if (!selectedFile || !token) { setMsg('upload-result','No file or not authenticated'); return; }
  const form = new FormData();
  form.append('file', selectedFile);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API}/api/upload`, true);
  xhr.setRequestHeader('Authorization', 'Bearer ' + token);

  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const pct = Math.round((ev.loaded / ev.total) * 100);
      show('progress-wrapper');
      el('progress').value = pct;
      el('progress-text').textContent = `${pct}%`;
    }
  };

  xhr.onreadystatechange = () => {
    if (xhr.readyState === 4) {
      hide('progress-wrapper');
      if (xhr.status === 200) {
        const j = JSON.parse(xhr.responseText);
        setMsg('upload-result', 'Upload successful. Public URL: ' + j.file.url);
        loadFiles();
      } else {
        try {
          const j = JSON.parse(xhr.responseText);
          setMsg('upload-result', 'Upload failed: ' + (j.error || xhr.statusText));
        } catch (e) {
          setMsg('upload-result', 'Upload failed: ' + xhr.statusText);
        }
      }
      el('progress').value = 0;
      el('progress-text').textContent = '';
    }
  };

  xhr.send(form);
});

async function loadFiles() {
  el('file-list').innerHTML = '';
  if (!token) return;
  try {
    const res = await fetch(`${API}/api/files`, { headers: { Authorization: 'Bearer ' + token }});
    if (!res.ok) throw new Error('Failed to load files');
    const files = await res.json();
    if (!files.length) {
      el('file-list').innerHTML = '<li>No files yet</li>';
      return;
    }
    files.forEach(f => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${f.originalName}</strong> (${Math.round(f.size/1024)} KB) — <a href="${f.url}" target="_blank">Open</a>`;
      el('file-list').appendChild(li);
    });
  } catch (err) {
    el('file-list').innerHTML = `<li>Error loading files</li>`;
  }
}
