import { sqlExec, sqlQuery } from '../lib/sql';

export const createAddress = async (userId: number, data: any) => {
  // Fix: Handle both isDefault and is_default from frontend
  // const { isDefault, ...addressData } = data;
  const { isDefault, is_default, ...addressData } = data;
  const isDefaultFlag = isDefault !== undefined ? isDefault : is_default;

  if (isDefaultFlag) {
    // Unset other default addresses for this user
    await sqlExec('UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND is_default = 1', [
      userId,
    ]);
  }

  // If this is the first address, make it default
  const countRows = await sqlQuery<any>(
    'SELECT COUNT(*) as count FROM user_addresses WHERE user_id = ?',
    [userId],
  );
  const count = Number(countRows[0].count);
  const finalIsDefault = count === 0 ? 1 : isDefaultFlag ? 1 : 0;

  const keys = Object.keys(addressData).map((k) => k.replace(/([A-Z])/g, '_$1').toLowerCase());
  const values = Object.values(addressData);

  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO user_addresses (${keys.join(', ')}, user_id, is_default, created_at) 
               VALUES (${placeholders}, ?, ?, CURRENT_TIMESTAMP(3))`;

  const res = await sqlExec(sql, [...values, userId, finalIsDefault]);
  const [newAddress] = await sqlQuery<any>('SELECT * FROM user_addresses WHERE id = ?', [
    res.insertId,
  ]);
  return newAddress;
};

export const listAddresses = async (userId: number) => {
  return sqlQuery<any>('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY created_at DESC', [
    userId,
  ]);
};

export const updateAddress = async (id: number, userId: number, data: any) => {
  // Fix: Handle both isDefault and is_default
  // const { isDefault, ...addressData } = data;
  const { isDefault, is_default, ...addressData } = data;
  const isDefaultFlag = isDefault !== undefined ? isDefault : is_default;

  if (isDefaultFlag) {
    await sqlExec('UPDATE user_addresses SET is_default = 0 WHERE user_id = ? AND id != ?', [
      userId,
      id,
    ]);
  }

  const keys = Object.keys(addressData).map(
    (k) => `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`,
  );
  const values = Object.values(addressData);

  const sql = `UPDATE user_addresses SET ${keys.join(', ')}, is_default = ? WHERE id = ? AND user_id = ?`;
  await sqlExec(sql, [...values, isDefaultFlag ? 1 : 0, id, userId]);

  const [updatedAddress] = await sqlQuery<any>('SELECT * FROM user_addresses WHERE id = ?', [id]);
  return updatedAddress;
};

export const deleteAddress = async (id: number, userId: number) => {
  return sqlExec('DELETE FROM user_addresses WHERE id = ? AND user_id = ?', [id, userId]);
};

export const setDefaultAddress = async (id: number, userId: number) => {
  await sqlExec('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [userId]);

  await sqlExec('UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ]);

  const [address] = await sqlQuery<any>('SELECT * FROM user_addresses WHERE id = ?', [id]);
  return address;
};
