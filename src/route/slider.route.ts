import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import {
  createSlider,
  getSliders,
  updateSlider,
  deleteSlider,
  toggleSlider,
} from '../service/slider.service';
import { serializeBigInt } from '../lib/utils';
import { upload } from '../middleware/multer';

const router = Router();

const desktopDir = path.join(process.cwd(), 'public', 'uploads', 'cmsSliders', 'desktop');
const mobileDir = path.join(process.cwd(), 'public', 'uploads', 'cmsSliders', 'mobile');

[desktopDir, mobileDir].forEach((dir) => {
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
});

async function saveFileBuffer(file: any, folderPath: string): Promise<string> {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const filename = uniqueSuffix + path.extname(file.originalname);
  await fs.writeFile(path.join(folderPath, filename), file.buffer);
  return filename;
}

// Robust conditional multer middleware specifically for slider routes
const sliderUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.includes('multipart/form-data')) {
    // Safety guard to prevent Postman / TCP early socket timeouts for multipart streams
    req.setTimeout(0);
    req.socket?.setTimeout(0);

    const cpUpload = upload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'imageMobile', maxCount: 1 },
    ]);

    cpUpload(req, res, (err) => {
      if (err) {
        console.error('Multer Error:', err);
        if (!res.headersSent) {
          return res.status(400).json({ error: 'File upload error', details: err.message });
        }
      }
      console.log('====================');
      console.log('▶️ STEP 1: MULTER UPLOAD PARSED SUCCESSFULLY!');
      console.log('====================');
      next();
    });
  } else {
    // If JSON or other, skip multer
    next();
  }
};

// CREATE
router.post('/', sliderUploadMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('====================');
    console.log('▶️ STEP 1: MULTER UPLOAD PARSED SUCCESSFULLY!');
    console.log('====================');
    const files = req.files as any;
    const body = (req.body as Record<string, any>) || {};

    let imageFile = null;
    let imageMobileFile = null;

    if (files?.image?.[0]) {
      imageFile = await saveFileBuffer(files.image[0], desktopDir);
    }
    if (files?.imageMobile?.[0]) {
      imageMobileFile = await saveFileBuffer(files.imageMobile[0], mobileDir);
    }

    const heading = typeof body.heading === 'string' ? body.heading.trim() : '';

    if (!heading) {
      res.status(400).json({ error: 'heading is required' });
      return;
    }

    const payload = {
      image: imageFile ? `/uploads/cmsSliders/desktop/${imageFile}` : body.image || null,
      imageMobile: imageMobileFile
        ? `/uploads/cmsSliders/mobile/${imageMobileFile}`
        : body.imageMobile || null,
      imageUrl: body.imageUrl,
      heading,
      subheading: typeof body.subheading === 'string' ? body.subheading.trim() : undefined,
      buttonText: typeof body.buttonText === 'string' ? body.buttonText.trim() : undefined,
      buttonRedirect:
        typeof body.buttonRedirect === 'string' ? body.buttonRedirect.trim() : undefined,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      isActive:
        body.isActive === 'true' || body.isActive === true
          ? true
          : body.isActive === 'false' || body.isActive === false
            ? false
            : undefined,
    };

    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );

    console.log('▶️ STEP 2: FIRING PRISMA CREATESLIDER WITH PAYLOAD...');
    const slider = await createSlider(cleanedPayload as any);
    console.log('▶️ STEP 3: PRISMA SUCCESSFUL! SENDING RESPONSE...');

    res.json(serializeBigInt(slider));
  } catch (error: any) {
    console.error('▶️ PRISMA ERROR (OR ROUTE ERROR):', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error creating slider', details: error?.message || error });
    }
  }
});

// GET ALL
router.get('/', async (req: Request, res: Response) => {
  try {
    const { active } = req.query;

    const sliders = await getSliders(active === 'true');
    res.json(serializeBigInt(sliders));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching sliders' });
  }
});

// UPDATE
router.put('/:id', sliderUploadMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const files = req.files as any;
    const body = (req.body as Record<string, any>) || {};

    let imageFile = null;
    let imageMobileFile = null;

    if (files?.image?.[0]) {
      imageFile = await saveFileBuffer(files.image[0], desktopDir);
    }
    if (files?.imageMobile?.[0]) {
      imageMobileFile = await saveFileBuffer(files.imageMobile[0], mobileDir);
    }

    const payload = {
      image: imageFile ? `/uploads/cmsSliders/desktop/${imageFile}` : body.image || null,
      imageMobile: imageMobileFile
        ? `/uploads/cmsSliders/mobile/${imageMobileFile}`
        : body.imageMobile || null,
      imageUrl: body.imageUrl,
      heading:
        typeof body.heading === 'string' && body.heading.trim() ? body.heading.trim() : undefined,
      subheading: typeof body.subheading === 'string' ? body.subheading.trim() : undefined,
      buttonText: typeof body.buttonText === 'string' ? body.buttonText.trim() : undefined,
      buttonRedirect:
        typeof body.buttonRedirect === 'string' ? body.buttonRedirect.trim() : undefined,
      sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : undefined,
      isActive:
        body.isActive === 'true' || body.isActive === true
          ? true
          : body.isActive === 'false' || body.isActive === false
            ? false
            : undefined,
    };

    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );

    if (Object.keys(cleanedPayload).length === 0) {
      res.status(400).json({ error: 'No update fields provided' });
      return;
    }

    const updated = await updateSlider(id, cleanedPayload as any);
    res.json(serializeBigInt(updated));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error updating slider' });
    }
  }
});

// DELETE
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    await deleteSlider(id);
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: 'Error deleting slider' });
  }
});

// TOGGLE
router.patch('/:id/toggle', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { isActive } = req.body;

    const updated = await toggleSlider(id, isActive);
    res.json(serializeBigInt(updated));
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: 'Error toggling slider' });
  }
});

export default router;
