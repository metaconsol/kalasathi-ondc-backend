import { sqlExec, sqlQuery } from '~/lib/sql';

export type BulkOrderStatus = 'pending' | 'in_progress' | 'reviewed' | 'completed' | 'cancelled';

export const allowedStatuses: BulkOrderStatus[] = [
  'pending',
  'in_progress',
  'reviewed',
  'completed',
  'cancelled',
];

export interface BulkOrderData {
  departmentName: string;
  address: string;
  contactPerson: string;
  email: string;
  countryCode: string;
  mobileNumber: string;
  description: string;
  attachmentUrl?: string;
}

export async function saveBulkOrder(data: BulkOrderData) {
  const sql = `
    INSERT INTO bulk_order_enquiries (
      department_name, 
      office_address, 
      contact_person, 
      email, 
      country_code, 
      mobile_number, 
      requirement_description, 
      attachment_url
    ) VALUES (
      :departmentName, 
      :address, 
      :contactPerson, 
      :email, 
      :countryCode, 
      :mobileNumber, 
      :description, 
      :attachmentUrl
    )
  `;

  const params = {
    departmentName: data.departmentName ?? null,
    address: data.address ?? null,
    contactPerson: data.contactPerson ?? null,
    email: data.email ?? null,
    countryCode: data.countryCode ?? null,
    mobileNumber: data.mobileNumber ?? null,
    description: data.description ?? null,
    attachmentUrl: data.attachmentUrl ?? null,
  };

  return await sqlExec(sql, params);
}

export async function getBulkOrders() {
  const sql = `
    SELECT * FROM bulk_order_enquiries 
    ORDER BY created_at DESC
  `;
  return await sqlQuery(sql);
}

export async function getBulkOrderById(id: string | number) {
  const sql = `
    SELECT * FROM bulk_order_enquiries 
    WHERE id = :id
  `;
  const results = await sqlQuery(sql, { id });
  return results[0] || null;
}

export async function updateBulkOrderStatusById(id: string | number, status: BulkOrderStatus) {
  const sql = `
    UPDATE bulk_order_enquiries 
    SET status = :status 
    WHERE id = :id
  `;
  return await sqlExec(sql, { id, status });
}
