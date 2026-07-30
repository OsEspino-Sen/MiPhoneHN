const fs = require('fs');
const path = require('path');
fs.readdirSync('admin').filter(f => f.endsWith('.html')).forEach(f => {
  const fp = path.join('admin', f);
  let c = fs.readFileSync(fp, 'utf8');
  c = c.replace(/href="index\.html"/g, 'href="../index.html"');
  c = c.replace(/href="tienda\.html"/g, 'href="../client/tienda.html"');
  c = c.replace(/href="nosotros\.html"/g, 'href="../client/nosotros.html"');
  c = c.replace(/href="soporte\.html"/g, 'href="../client/soporte.html"');
  fs.writeFileSync(fp, c);
});

// Update admin.js redirects
const adminJsPath = path.join('admin', 'admin.js');
if (fs.existsSync(adminJsPath)) {
  let adminJs = fs.readFileSync(adminJsPath, 'utf8');
  adminJs = adminJs.replace(/window\.location\.href\s*=\s*['"]index\.html['"]/g, 'window.location.href = "../index.html"');
  adminJs = adminJs.replace(/window\.location\.href\s*=\s*['"]login\.html['"]/g, 'window.location.href = "login.html"');
  fs.writeFileSync(adminJsPath, adminJs);
}
