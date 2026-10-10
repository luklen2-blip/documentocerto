const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(os.homedir(), 'Desktop');
const zipPath = path.join(desktopDir, 'DocumentoCerto-deploy.zip');

console.log(`Gerando: ${zipPath}`);
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

const psScript = `
$dest = '${zipPath.replace(/\\/g, '\\\\')}';
$exclude = @('node_modules', '.git', 'package-lock.json');
Get-ChildItem -Path '${rootDir.replace(/\\/g, '\\\\')}' | Where-Object { $exclude -notcontains $_.Name } | Compress-Archive -DestinationPath $dest -Force;
`;

execSync('powershell -NoProfile -Command "' + psScript.replace(/\n/g, ' ') + '"', { stdio: 'inherit' });
console.log('Sucesso! Tamanho:', (fs.statSync(zipPath).size / 1024).toFixed(1), 'KB');
