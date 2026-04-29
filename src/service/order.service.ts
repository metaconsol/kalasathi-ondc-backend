import { sqlExec, sqlQuery, withSqlTransaction } from '~/lib/sql';

export const createOrder = async (userId: number, data: any) => {
  const { cart_id, billing_address, shipping_address, currency = 'INR' } = data;

  const parsedCartId = BigInt(cart_id);

  // Validate Cart
  const cartRows = await sqlQuery<any>('SELECT * FROM `carts` WHERE `id` = ? LIMIT 1', [
    parsedCartId,
  ]);
  const cart = cartRows[0] ?? null;

  if (!cart) {
    throw new Error('Cart not found');
  }

  if (cart.user_id !== null && BigInt(cart.user_id) !== BigInt(userId)) {
    throw new Error('Cart belongs to a different user');
  }

  const items = await sqlQuery<any>(
    'SELECT * FROM `cart_items` WHERE `cart_id` = ? ORDER BY `id` ASC',
    [parsedCartId],
  );
  if (items.length === 0) {
    throw new Error('Cart is empty');
  }

  // Calculate total amount
  let totalAmount = 0;
  items.forEach((item: any) => {
    totalAmount += item.qty * Number(item.priceSnapshot);
  });

  // Determine the date prefix (e.g., ORD-20260425-)
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ORD-${dateStr}-`;

  // We'll generate a placeholder order_no first since we need the auto-increment ID
  const temp_order_no = `TEMP-${Date.now()}`;

  // Addresses
  const billingAddress = { ...billing_address, type: 'billing' };
  const shippingAddress = shipping_address
    ? { ...shipping_address, type: 'shipping' }
    : { ...billing_address, type: 'shipping' };

  // Run transaction
  const result = await withSqlTransaction(async (tx) => {
    // 1. Create Order with temp order_no
    const orderRes = await sqlExec(
      'INSERT INTO `orders` (`order_no`, `user_id`, `cart_id`, `status`, `payment_status`, `currency`, `total_amount`) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [temp_order_no, userId, parsedCartId, 'pending', 'pending', currency, totalAmount],
      tx,
    );
    const orderId = BigInt(orderRes.insertId as any);

    // 2. Update final order_no
    const final_order_no = `${prefix}${String(orderId).padStart(4, '0')}`;
    await sqlExec(
      'UPDATE `orders` SET `order_no` = ? WHERE `id` = ?',
      [final_order_no, orderId],
      tx,
    );

    // 3. Create OrderItems
    for (const item of items) {
      await sqlExec(
        'INSERT INTO `order_items` (`order_id`, `product_id`, `variant_id`, `qty`, `price`, `total`, `item_status`) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          orderId,
          item.product_id,
          item.variant_id,
          item.qty,
          item.price_snapshot,
          item.qty * Number(item.price_snapshot),
          'pending',
        ],
        tx,
      );
    }

    // 4. Create Addresses
    for (const addr of [billingAddress, shippingAddress]) {
      await sqlExec(
        'INSERT INTO `order_addresses` (`order_id`, `type`, `full_name`, `phone`, `address_line1`, `address_line2`, `city`, `state`, `country`, `pincode`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          orderId,
          addr.type,
          addr.full_name,
          addr.phone,
          addr.address_line1,
          addr.address_line2 ?? null,
          addr.city,
          addr.state,
          addr.country,
          addr.pincode,
        ],
        tx,
      );
    }

    // 5. Seller units
    const storeIds = [...new Set(items.map((it: any) => String(it.store_id)))];
    if (storeIds.length) {
      const storeRows = await sqlQuery<any>(
        `SELECT \`id\`, \`seller_user_id\` as sellerUserId FROM \`stores\` WHERE \`id\` IN (${storeIds
          .map(() => '?')
          .join(',')})`,
        storeIds.map((s) => BigInt(s)),
        tx,
      );
      const storeMap = new Map(storeRows.map((s: any) => [String(s.id), s.sellerUserId]));
      for (const sid of storeIds) {
        await sqlExec(
          'INSERT INTO `seller_units` (`order_id`, `store_id`, `seller_id`, `status`) VALUES (?, ?, ?, ?)',
          [orderId, BigInt(sid), storeMap.get(sid) ?? 0, 'pending'],
          tx,
        );
      }
    }

    // 6. Clear cart
    await sqlExec('DELETE FROM `cart_items` WHERE `cart_id` = ?', [parsedCartId], tx);
    await sqlExec(
      'UPDATE `carts` SET `status` = ? WHERE `id` = ?',
      ['converted', parsedCartId],
      tx,
    );

    const orders = await sqlQuery<any>(
      'SELECT * FROM `orders` WHERE `id` = ? LIMIT 1',
      [orderId],
      tx,
    );
    return orders[0] ?? null;
  });

  return result;
};

export const listOrders = async (userId: number, filters: any) => {
  const { status, payment_status, page, limit } = filters;

  const skip = (page - 1) * limit;

  const args: any[] = [userId];
  let whereSql = '`user_id` = ?';
  if (status) {
    whereSql += ' AND `status` = ?';
    args.push(status);
  }
  if (payment_status) {
    whereSql += ' AND `payment_status` = ?';
    args.push(payment_status);
  }

  const [data, totalRows] = await Promise.all([
    sqlQuery<any>(
      `SELECT * FROM \`orders\` WHERE ${whereSql} ORDER BY \`created_at\` DESC LIMIT ? OFFSET ?`,
      [...args, limit, skip],
    ),
    sqlQuery<{ total: number }>(`SELECT COUNT(*) as total FROM \`orders\` WHERE ${whereSql}`, args),
  ]);
  const total = Number(totalRows?.[0]?.total ?? 0);

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getOrderDetails = async (userId: number, idOrNo: string) => {
  const isNumeric = /^\d+$/.test(idOrNo);
  const args: any[] = [userId];
  let whereSql = '`user_id` = ?';
  if (isNumeric) {
    whereSql += ' AND `id` = ?';
    args.push(BigInt(idOrNo));
  } else {
    whereSql += ' AND `order_no` = ?';
    args.push(idOrNo);
  }
  const orders = await sqlQuery<any>(`SELECT * FROM \`orders\` WHERE ${whereSql} LIMIT 1`, args);
  const order = orders[0] ?? null;
  if (!order) return null;
  const [items, addresses, seller_units] = await Promise.all([
    sqlQuery<any>('SELECT * FROM `order_items` WHERE `order_id` = ? ORDER BY `id` ASC', [order.id]),
    sqlQuery<any>('SELECT * FROM `order_addresses` WHERE `order_id` = ? ORDER BY `id` ASC', [
      order.id,
    ]),
    sqlQuery<any>('SELECT * FROM `seller_units` WHERE `order_id` = ? ORDER BY `id` ASC', [
      order.id,
    ]),
  ]);
  return { ...order, items, addresses, seller_units };
};

export const cancelOrder = async (userId: number, id: string, note?: string) => {
  const isNumeric = /^\d+$/.test(id);
  const args: any[] = [userId];
  let whereSql = '`user_id` = ?';
  if (isNumeric) {
    whereSql += ' AND `id` = ?';
    args.push(BigInt(id));
  } else {
    whereSql += ' AND `order_no` = ?';
    args.push(id);
  }
  const rows = await sqlQuery<any>(`SELECT * FROM \`orders\` WHERE ${whereSql} LIMIT 1`, args);
  const order = rows[0] ?? null;

  if (!order) {
    throw new Error('Order not found');
  }

  if (order.status !== 'pending' && order.status !== 'confirmed') {
    throw new Error('Cannot cancel order because it is not in pending or confirmed state');
  }

  const result = await withSqlTransaction(async (tx) => {
    await sqlExec('UPDATE `orders` SET `status` = ? WHERE `id` = ?', ['cancelled', order.id], tx);
    await sqlExec(
      'UPDATE `order_items` SET `item_status` = ? WHERE `order_id` = ?',
      ['cancelled', order.id],
      tx,
    );
    await sqlExec(
      'UPDATE `seller_units` SET `status` = ? WHERE `order_id` = ?',
      ['cancelled', order.id],
      tx,
    );
    const updated = await sqlQuery<any>(
      'SELECT * FROM `orders` WHERE `id` = ? LIMIT 1',
      [order.id],
      tx,
    );
    return updated[0] ?? null;
  });

  return result;
};

export const orderTracking = async (userId: number, id: string) => {
  const isNumeric = /^\d+$/.test(id);
  const args: any[] = [userId];
  let whereSql = '`user_id` = ?';
  if (isNumeric) {
    whereSql += ' AND `id` = ?';
    args.push(BigInt(id));
  } else {
    whereSql += ' AND `order_no` = ?';
    args.push(id);
  }
  const orders = await sqlQuery<any>(`SELECT * FROM \`orders\` WHERE ${whereSql} LIMIT 1`, args);
  const order = orders[0] ?? null;

  if (!order) {
    throw new Error('Order not found');
  }

  const seller_units = await sqlQuery<any>(
    'SELECT `id`, `tracking_no`, `logistics_provider`, `status` FROM `seller_units` WHERE `order_id` = ? ORDER BY `id` ASC',
    [order.id],
  );
  return { seller_units };
};

export const listReturns = async (userId: number, id: string) => {
  const isNumeric = /^\d+$/.test(id);
  const args: any[] = [userId];
  let whereSql = '`user_id` = ?';
  if (isNumeric) {
    whereSql += ' AND `id` = ?';
    args.push(BigInt(id));
  } else {
    whereSql += ' AND `order_no` = ?';
    args.push(id);
  }
  const orders = await sqlQuery<any>(`SELECT * FROM \`orders\` WHERE ${whereSql} LIMIT 1`, args);
  const order = orders[0] ?? null;

  if (!order) {
    throw new Error('Order not found');
  }

  const returns = await sqlQuery<any>(
    'SELECT * FROM `returns` WHERE `order_id` = ? ORDER BY `created_at` DESC',
    [order.id],
  );

  return returns;
};

export const requestReturn = async (userId: number, id: string, data: any) => {
  const { order_item_id, reason, refund_amount, refund_mode } = data;

  const isNumeric = /^\d+$/.test(id);
  const args: any[] = [userId];
  let whereSql = '`user_id` = ?';
  if (isNumeric) {
    whereSql += ' AND `id` = ?';
    args.push(BigInt(id));
  } else {
    whereSql += ' AND `order_no` = ?';
    args.push(id);
  }
  const orders = await sqlQuery<any>(`SELECT * FROM \`orders\` WHERE ${whereSql} LIMIT 1`, args);
  const order = orders[0] ?? null;

  if (!order) {
    throw new Error('Order not found');
  }

  const itemRows = await sqlQuery<any>(
    'SELECT * FROM `order_items` WHERE `id` = ? AND `order_id` = ? LIMIT 1',
    [BigInt(order_item_id), order.id],
  );
  const orderItem = itemRows[0] ?? null;

  if (!orderItem) {
    throw new Error('Order Item not found or does not belong to this order');
  }

  if (orderItem.item_status !== 'delivered') {
    throw new Error('Can only return delivered items');
  }

  const result = await withSqlTransaction(async (tx) => {
    const res = await sqlExec(
      'INSERT INTO `returns` (`order_id`, `order_item_id`, `reason`, `refund_amount`, `refund_mode`, `status`) VALUES (?, ?, ?, ?, ?, ?)',
      [order.id, orderItem.id, reason, Number(refund_amount), refund_mode, 'pending'],
      tx,
    );
    await sqlExec(
      'UPDATE `order_items` SET `item_status` = ? WHERE `id` = ?',
      ['returned', orderItem.id],
      tx,
    );
    const rows = await sqlQuery<any>(
      'SELECT * FROM `returns` WHERE `id` = ? LIMIT 1',
      [BigInt(res.insertId as any)],
      tx,
    );
    return rows[0] ?? null;
  });

  return result;
};
