import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const tenantId = req.user?.tenantId || 'anonymous';
      const processId = req.body?.processId || req.params?.processId || 'general';

      // Sanitização estrita contra path traversal
      const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
      const safeProcess = processId.replace(/[^a-zA-Z0-9_-]/g, '');

      const uploadDir = path.resolve(process.cwd(), 'storage', 'private', safeTenant, safeProcess);

      // Verificação de contenção dentro do diretório base de armazenamento
      const baseStorage = path.resolve(process.cwd(), 'storage', 'private');
      if (!uploadDir.startsWith(baseStorage)) {
        return cb(new Error('Tentativa de violação de diretório detectada.'));
      }

      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      cb(null, uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanBaseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `${uniqueSuffix}_${cleanBaseName}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype.toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext) || !ALLOWED_MIME_TYPES.includes(mime)) {
    return cb(new Error('Tipo de arquivo não permitido. Apenas PDF, JPG, JPEG e PNG são aceitos.'));
  }

  cb(null, true);
};

export const documentUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
});
