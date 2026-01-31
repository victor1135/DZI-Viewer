const fs = require('fs');
const path = require('path');

// 404.html 内容
const html404 = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting...</title>
  <script>
    // GitHub Pages 404 handler for SPA routing
    var path = window.location.pathname;
    var search = window.location.search;
    var hash = window.location.hash;
    var newPath = path.replace(/\\/$/, '') + '/index.html' + search + hash;
    window.location.replace(newPath);
  </script>
  <meta http-equiv="refresh" content="0; url=./index.html">
</head>
<body>
  <p>Redirecting to <a href="./index.html">index.html</a>...</p>
</body>
</html>`;

// 目标路径
const distPath = path.join(__dirname, '../dist/open-seaddragon-demo/browser/404.html');

// 确保目录存在
const distDir = path.dirname(distPath);
if (!fs.existsSync(distDir)) {
  console.error('Dist directory does not exist. Please build the project first.');
  process.exit(1);
}

// 写入 404.html
fs.writeFileSync(distPath, html404, 'utf8');
console.log('404.html created successfully at:', distPath);
