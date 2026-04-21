import type { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import path from 'path';
import * as sliderService from '~/service/cms/slider.service';
import { ApiResponse } from '~/lib/response';
import { serializeBigInt, formatFileUrl } from '~/lib/utils';

const desktopDir = path.join(process.cwd(), 'public', 'uploads', 'cmsSliders', 'desktop');
const mobileDir = path.join(process.cwd(), 'public', 'uploads', 'cmsSliders', 'mobile');

async function saveFileBuffer(file: any, folderPath: string): Promise<string> {
  // Ensure the directory exists
  await fs.mkdir(folderPath, { recursive: true });

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const filename = uniqueSuffix + path.extname(file.originalname);
  await fs.writeFile(path.join(folderPath, filename), file.buffer);
  return filename;
}

// Function to format slider response with dynamic URLs
const formatSliderResponse = (slider: any) => {
  if (!slider) return null;
  if (Array.isArray(slider)) return slider.map(formatSliderResponse);

  return {
    ...slider,
    image: formatFileUrl(slider.image),
    imageMobile: formatFileUrl(slider.imageMobile),
  };
};

export const createSlider = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const files = req.files as any;
    const body = req.body || {};

    let imageFile = null;
    let imageMobileFile = null;

    if (files?.image?.[0]) {
      imageFile = await saveFileBuffer(files.image[0], desktopDir);
    }
    if (files?.imageMobile?.[0]) {
      imageMobileFile = await saveFileBuffer(files.imageMobile[0], mobileDir);
    }

    const heading = typeof body.heading === 'string' ? body.heading.trim() : '';
    if (!heading) return ApiResponse.badRequest(res, 'Heading is required');

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
      sortOrder: body.sortOrder === undefined || body.sortOrder === '' ? 0 : Number(body.sortOrder),
      isActive: body.isActive === 'false' ? false : true,
    };

    // Note: No need to cleanPayload and remove undefined because we've provided defaults above
    const slider = await sliderService.createSlider(payload as any);
    return ApiResponse.created(
      res,
      'Slider created successfully',
      serializeBigInt(formatSliderResponse(slider)),
    );
  } catch (error) {
    next(error);
  }
};

export const getSliders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { active } = req.query;
    const sliders = await sliderService.getSliders(active === 'true');
    return ApiResponse.success(
      res,
      'Sliders fetched successfully',
      serializeBigInt(formatSliderResponse(sliders)),
    );
  } catch (error) {
    next(error);
  }
};

export const updateSlider = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const files = req.files as any;
    const body = req.body || {};

    let imageFile = null;
    let imageMobileFile = null;

    if (files?.image?.[0]) {
      imageFile = await saveFileBuffer(files.image[0], desktopDir);
    }
    if (files?.imageMobile?.[0]) {
      imageMobileFile = await saveFileBuffer(files.imageMobile[0], mobileDir);
    }

    const payload: any = {
      image: imageFile ? `/uploads/cmsSliders/desktop/${imageFile}` : body.image || undefined,
      imageMobile: imageMobileFile
        ? `/uploads/cmsSliders/mobile/${imageMobileFile}`
        : body.imageMobile || undefined,
      imageUrl: body.imageUrl,
      heading:
        typeof body.heading === 'string' && body.heading.trim() ? body.heading.trim() : undefined,
      subheading: typeof body.subheading === 'string' ? body.subheading.trim() : undefined,
      buttonText: typeof body.buttonText === 'string' ? body.buttonText.trim() : undefined,
      buttonRedirect:
        typeof body.buttonRedirect === 'string' ? body.buttonRedirect.trim() : undefined,
    };

    if (body.sortOrder !== undefined && body.sortOrder !== '') {
      payload.sortOrder = Number(body.sortOrder);
    }
    if (body.isActive !== undefined) {
      payload.isActive = body.isActive === 'false' ? false : true;
    }

    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );

    if (Object.keys(cleanedPayload).length === 0)
      return ApiResponse.badRequest(res, 'No update fields provided');

    const updated = await sliderService.updateSlider(id, cleanedPayload as any);
    return ApiResponse.success(
      res,
      'Slider updated successfully',
      serializeBigInt(formatSliderResponse(updated)),
    );
  } catch (error) {
    next(error);
  }
};

export const deleteSlider = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await sliderService.deleteSlider(id);
    return ApiResponse.success(res, 'Slider deleted successfully');
  } catch (error) {
    next(error);
  }
};

export const toggleSlider = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { isActive } = req.body;
    const updated = await sliderService.toggleSlider(id, isActive);
    return ApiResponse.success(
      res,
      'Slider status toggled successfully',
      serializeBigInt(formatSliderResponse(updated)),
    );
  } catch (error) {
    next(error);
  }
};
