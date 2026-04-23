import { db } from '~/lib/db';

/**
 * Generate a unique slug from a title
 */
export const generateSlug = async (title: string, currentId?: number): Promise<string> => {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with a single hyphen
    .replace(/^-+|-+$/g, ''); // Remove leading and trailing hyphens

  let uniqueSlug = slug;
  let counter = 1;

  while (true) {
    const existing = await db.blog.findUnique({
      where: { slug: uniqueSlug },
    });

    // If no existing blog has this slug, or if the blog with this slug is the one we're updating
    if (!existing || (currentId && existing.id === currentId)) {
      break;
    }

    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }

  return uniqueSlug;
};

/**
 * Create a new blog post
 */
export const createBlog = async (data: {
  title: string;
  subheading?: string;
  content: string;
  featuredImage?: string;
  isPublished?: boolean;
}) => {
  const slug = await generateSlug(data.title);

  return await db.blog.create({
    data: {
      ...data,
      slug,
      isPublished: data.isPublished !== undefined ? data.isPublished : true,
    },
  });
};

/**
 * Get all blog posts with optional search and pagination
 */
export const getAllBlogs = async (params: {
  onlyPublished?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}) => {
  const { onlyPublished = true, search, page = 1, limit = 10 } = params;
  const skip = (page - 1) * limit;

  const where = {
    deletedAt: null,
    ...(onlyPublished ? { isPublished: true } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search } },
            { subheading: { contains: search } },
            { content: { contains: search } },
          ],
        }
      : {}),
  };

  const [blogs, total] = await Promise.all([
    db.blog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.blog.count({ where }),
  ]);

  return {
    blogs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get a single blog post by ID or Slug
 */
export const getBlogByIdOrSlug = async (idOrSlug: string) => {
  // Check if it's a numeric ID
  const isNumeric = /^\d+$/.test(idOrSlug);

  return await db.blog.findFirst({
    where: {
      OR: [...(isNumeric ? [{ id: parseInt(idOrSlug, 10) }] : []), { slug: idOrSlug }],
      deletedAt: null,
    },
  });
};

/**
 * Update a blog post
 */
export const updateBlog = async (id: number, data: any) => {
  // If title is being updated, optionally update the slug
  if (data.title) {
    data.slug = await generateSlug(data.title, id);
  }

  return await db.blog.update({
    where: { id },
    data,
  });
};

/**
 * (Soft) Delete a blog post
 */
export const deleteBlog = async (id: number) => {
  return await db.blog.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
};
