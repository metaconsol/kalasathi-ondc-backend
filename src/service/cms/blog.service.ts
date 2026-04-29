import { sqlExec, sqlQuery } from '~/lib/sql';

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
    const rows = await sqlQuery<{ id: number }>(
      'SELECT `id` FROM `blogs` WHERE `slug` = ? LIMIT 1',
      [uniqueSlug],
    );
    const existing = rows[0] ?? null;

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

  const res = await sqlExec(
    'INSERT INTO `Blog` (`title`, `subheading`, `content`, `featuredImage`, `slug`, `isPublished`) VALUES (?, ?, ?, ?, ?, ?)',
    [
      data.title,
      data.subheading ?? null,
      data.content,
      data.featuredImage ?? null,
      slug,
      data.isPublished !== undefined ? data.isPublished : true,
    ],
  );
  const rows = await sqlQuery('SELECT * FROM `blogs` WHERE `id` = ? LIMIT 1', [
    Number(res.insertId),
  ]);
  return rows[0] ?? null;
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
  const args: any[] = [];
  let whereSql = '`deletedAt` IS NULL';
  if (onlyPublished) {
    whereSql += ' AND `isPublished` = true';
  }
  if (search && String(search).trim().length) {
    whereSql += ' AND (`title` LIKE ? OR `subheading` LIKE ? OR `content` LIKE ?)';
    const s = `%${String(search).trim()}%`;
    args.push(s, s, s);
  }

  const [blogs, totalRows] = await Promise.all([
    sqlQuery(
      `SELECT * FROM \`blogs\` WHERE ${whereSql} ORDER BY \`createdAt\` DESC LIMIT ? OFFSET ?`,
      [...args, limit, skip],
    ),
    sqlQuery<{ total: number }>(`SELECT COUNT(*) as total FROM \`blogs\` WHERE ${whereSql}`, args),
  ]);
  const total = Number(totalRows?.[0]?.total ?? 0);

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

  if (isNumeric) {
    const rows = await sqlQuery(
      'SELECT * FROM `blogs` WHERE `deletedAt` IS NULL AND (`id` = ? OR `slug` = ?) LIMIT 1',
      [parseInt(idOrSlug, 10), idOrSlug],
    );
    return rows[0] ?? null;
  }
  const rows = await sqlQuery(
    'SELECT * FROM `blogs` WHERE `deletedAt` IS NULL AND `slug` = ? LIMIT 1',
    [idOrSlug],
  );
  return rows[0] ?? null;
};

/**
 * Update a blog post
 */
export const updateBlog = async (id: number, data: any) => {
  // If title is being updated, optionally update the slug
  if (data.title) {
    data.slug = await generateSlug(data.title, id);
  }

  const allowed = [
    'title',
    'subheading',
    'content',
    'featuredImage',
    'slug',
    'isPublished',
    'deletedAt',
    'updatedAt',
  ];
  const fields: string[] = [];
  const values: any[] = [];
  for (const k of allowed) {
    if (data?.[k] !== undefined) {
      fields.push(`\`${k}\` = ?`);
      values.push(data[k]);
    }
  }
  if (fields.length) {
    await sqlExec(`UPDATE \`blogs\` SET ${fields.join(', ')} WHERE \`id\` = ?`, [...values, id]);
  }
  const rows = await sqlQuery('SELECT * FROM `blogs` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0] ?? null;
};

/**
 * (Soft) Delete a blog post
 */
export const deleteBlog = async (id: number) => {
  await sqlExec('UPDATE `blogs` SET `deletedAt` = NOW() WHERE `id` = ?', [id]);
  const rows = await sqlQuery('SELECT * FROM `blogs` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0] ?? null;
};
