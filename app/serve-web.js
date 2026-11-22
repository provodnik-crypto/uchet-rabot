// Локальный показ веб-версии «Учёт работ» (для компьютера: МВСО и инициаторы).
// Запускается ярлыками с рабочего стола. Если сервер уже работает — просто выходит.
// Статику берёт из app/dist-web (пересобирается командой expo export при каждом обновлении).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8090;
const ROOT = path.join(__dirname, 'dist-web');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(ROOT, 'index.html'); // SPA: любой путь — приложение
    fs.readFile(file, (err2, data) => {
      if (err2) { res.writeHead(500); return res.end('Нет сборки: запустите экспорт (expo export --platform web)'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
});

server.on('error', () => { /* порт занят — сервер уже запущен */ process.exit(0); });
server.listen(PORT, '127.0.0.1', () => {
  console.log('Учёт работ: http://localhost:' + PORT + ' (окно можно закрыть — сервер работает, пока открыт этот процесс)');
});
