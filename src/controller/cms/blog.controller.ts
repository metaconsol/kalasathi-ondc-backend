import type { Request, Response, NextFunction } from 'express';
import * as blogService from '~/service/cms/blog.service';
import { ApiResponse } from '~/lib/response';

/**
 * Handle blog creation
 */
export const createBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, subheading, content, featuredImage, isPublished } = req.body;

    // Validation: Title and content are required
    if (!title || !content) {
      return ApiResponse.badRequest(res, 'Title and content are required');
    }

    const blog = await blogService.createBlog({
      title,
      subheading,
      content,
      featuredImage,
      isPublished:
        isPublished !== undefined ? isPublished === 'true' || isPublished === true : true,
    });

    return ApiResponse.created(res, 'Blog post created successfully', blog);
  } catch (error) {
    next(error);
  }
};

/**
 * Handle listing all blog posts
 */
export const getAllBlogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { published, search, page, limit } = req.query;

    const result = await blogService.getAllBlogs({
      onlyPublished: published === undefined ? true : published === 'true' || published === true,
      search: search as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
    });

    return ApiResponse.success(res, 'Blogs fetched successfully', result.blogs, result.pagination);
  } catch (error) {
    next(error);
  }
};

/**
 * Handle fetching a single blog post
 */
export const getBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const blog = await blogService.getBlogByIdOrSlug(id);

    if (!blog) {
      return ApiResponse.notFound(res, 'Blog post not found');
    }

    return ApiResponse.success(res, 'Blog post fetched successfully', blog);
  } catch (error) {
    next(error);
  }
};

/**
 * Handle updating a blog post
 */
export const updateBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const body = req.body;

    if (isNaN(id)) {
      return ApiResponse.badRequest(res, 'Invalid blog ID');
    }

    // Type conversion for boolean field if coming from form-data or query
    if (body.isPublished !== undefined) {
      body.isPublished = body.isPublished === 'true' || body.isPublished === true;
    }

    const updated = await blogService.updateBlog(id, body);
    return ApiResponse.success(res, 'Blog post updated successfully', updated);
  } catch (error) {
    next(error);
  }
};

/**
 * Handle deleting a blog post
 */
export const deleteBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);

    if (isNaN(id)) {
      return ApiResponse.badRequest(res, 'Invalid blog ID');
    }

    await blogService.deleteBlog(id);
    return ApiResponse.success(res, 'Blog post deleted successfully');
  } catch (error) {
    next(error);
  }
};
