import { sqlQuery } from '~/lib/sql';

export class DistrictService {
  private constructor() {}

  public static getInstance(): DistrictService {
    return new DistrictService();
  }

  /**
   * Fetches distinct districts from the products table along with their active product counts.
   */
  public async getDistrictsWithCounts(region?: string) {
    let whereSql = `
      p.publish_status = 'publish' 
      AND p.visibility = 'PUBLIC' 
      AND s.is_active = 1 
      AND s.deleted_at IS NULL 
      AND c.is_active = 1
      AND p.district IS NOT NULL
      AND p.district != ''
    `;
    const args: any[] = [];

    if (region && region !== 'all') {
      whereSql += ' AND p.region = ?';
      args.push(region);
    }

    const query = `
      SELECT 
        TRIM(district) as name, 
        MAX(region) as region,
        MAX(district_icon) as icon,
        COUNT(*) as productCount
      FROM products p
      JOIN stores s ON s.id = p.store_id
      JOIN categories c ON c.id = p.category_id
      WHERE ${whereSql}
      GROUP BY TRIM(district)
      ORDER BY name ASC
    `;

    const rows = await sqlQuery<{
      name: string;
      region: string;
      icon: string;
      productCount: number;
    }>(query, args);
    return rows;
  }
}

export const districtService = DistrictService.getInstance();
