import { db } from '../lib/db';

export const createAddress = async (userId: number, data: any) => {
  const { isDefault, ...addressData } = data;

  if (isDefault) {
    // Unset other default addresses for this user
    await db.userAddress.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  // If this is the first address, make it default
  const count = await db.userAddress.count({ where: { userId } });
  const finalIsDefault = count === 0 ? true : !!isDefault;

  return db.userAddress.create({
    data: {
      ...addressData,
      userId,
      isDefault: finalIsDefault,
    },
  });
};

export const listAddresses = async (userId: number) => {
  return db.userAddress.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
};

export const updateAddress = async (id: number, userId: number, data: any) => {
  const { isDefault, ...addressData } = data;

  if (isDefault) {
    await db.userAddress.updateMany({
      where: { userId, isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
  }

  return db.userAddress.update({
    where: { id, userId },
    data: {
      ...addressData,
      isDefault,
    },
  });
};

export const deleteAddress = async (id: number, userId: number) => {
  return db.userAddress.delete({
    where: { id, userId },
  });
};

export const setDefaultAddress = async (id: number, userId: number) => {
  await db.userAddress.updateMany({
    where: { userId, isDefault: true },
    data: { isDefault: false },
  });

  return db.userAddress.update({
    where: { id, userId },
    data: { isDefault: true },
  });
};
