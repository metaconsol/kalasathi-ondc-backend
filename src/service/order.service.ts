import { sqlExec, sqlQuery, withSqlTransaction } from '~/lib/sql';
import { mailServiceAsync } from './mail/mail.service';
import { BuyerMailTemplate } from './mail/buyer.mail.template';
import { SellerMailTemplate } from './mail/seller.mail.template';

// export const createOrder = async (userId: number, data: any) => {
//   const { cart_id, billing_address, shipping_address, currency = 'INR' } = data;

//   const parsedCartId = BigInt(cart_id);

//   // Validate Cart
//   const cartRows = await sqlQuery<any>('SELECT * FROM `carts` WHERE `id` = ? LIMIT 1', [
//     parsedCartId,
//   ]);
//   const cart = cartRows[0] ?? null;

//   if (!cart) {
//     throw new Error('Cart not found');
//   }

//   if (cart.user_id !== null && BigInt(cart.user_id) !== BigInt(userId)) {
//     throw new Error('Cart belongs to a different user');
//   }

//   const items = await sqlQuery<any>(
//     'SELECT * FROM `cart_items` WHERE `cart_id` = ? ORDER BY `id` ASC',
//     [parsedCartId],
//   );
//   if (items.length === 0) {
//     throw new Error('Cart is empty');
//   }

//   // Calculate total amount
//   let totalAmount = 0;
//   items.forEach((item: any) => {
//     totalAmount += item.qty * Number(item.price_snapshot);
//   });

//   // Determine the date prefix (e.g., ORD-20260425-)
//   const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
//   const prefix = `ORD-${dateStr}-`;

//   // We'll generate a placeholder order_no first since we need the auto-increment ID
//   const temp_order_no = `TEMP-${Date.now()}`;

//   // Addresses
//   const billingAddress = { ...billing_address, type: 'billing' };
//   const shippingAddress = shipping_address
//     ? { ...shipping_address, type: 'shipping' }
//     : { ...billing_address, type: 'shipping' };

//   // Run transaction
//   const result = await withSqlTransaction(async (tx) => {
//     // 1. Create Order with temp order_no
//     const orderRes = await sqlExec(
//       'INSERT INTO `orders` (`order_no`, `user_id`, `cart_id`, `status`, `payment_status`, `currency`, `total_amount`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
//       [temp_order_no, userId, parsedCartId, 'pending', 'pending', currency, totalAmount],
//       tx,
//     );
//     const orderId = BigInt(orderRes.insertId as any);

//     // 2. Update final order_no
//     const final_order_no = `${prefix}${String(orderId).padStart(4, '0')}`;
//     await sqlExec(
//       'UPDATE `orders` SET `order_no` = ?, `updated_at` = NOW() WHERE `id` = ?',
//       [final_order_no, orderId],
//       tx,
//     );

//     // 3. Create OrderItems
//     for (const item of items) {
//       await sqlExec(
//         'INSERT INTO `order_items` (`order_id`, `product_id`, `variant_id`, `qty`, `price`, `total`, `item_status`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
//         [
//           orderId,
//           item.product_id,
//           item.variant_id,
//           item.qty,
//           item.price_snapshot,
//           item.qty * Number(item.price_snapshot),
//           'pending',
//         ],
//         tx,
//       );
//     }

//     // 4. Create Addresses
//     for (const addr of [billingAddress, shippingAddress]) {
//       await sqlExec(
//         'INSERT INTO `order_addresses` (`order_id`, `type`, `full_name`, `phone`, `address_line1`, `address_line2`, `city`, `district_id`, `state`, `state_id`, `country`, `pincode`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
//         [
//           orderId,
//           addr.type,
//           addr.full_name,
//           addr.phone,
//           addr.address_line1,
//           addr.address_line2 ?? null,
//           addr.city,
//           addr.city_id ?? null,
//           addr.state,
//           addr.state_id ?? null,
//           addr.country,
//           addr.pincode,
//         ],
//         tx,
//       );
//     }

//     // 5. Seller units
//     const storeIds = [...new Set(items.map((it: any) => String(it.store_id)))];
//     if (storeIds.length) {
//       const storeRows = await sqlQuery<any>(
//         `SELECT \`id\`, \`seller_user_id\` as sellerUserId FROM \`stores\` WHERE \`id\` IN (${storeIds
//           .map(() => '?')
//           .join(',')})`,
//         storeIds.map((s) => BigInt(s)),
//         tx,
//       );
//       const storeMap = new Map(storeRows.map((s: any) => [String(s.id), s.sellerUserId]));
//       for (const sid of storeIds) {
//         await sqlExec(
//           'INSERT INTO `seller_units` (`order_id`, `store_id`, `seller_id`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, NOW(), NOW())',
//           [orderId, BigInt(sid), storeMap.get(sid) ?? 0, 'pending'],
//           tx,
//         );
//       }
//     }

//     // 6. Clear cart
//     await sqlExec('DELETE FROM `cart_items` WHERE `cart_id` = ?', [parsedCartId], tx);
//     await sqlExec(
//       'UPDATE `carts` SET `status` = ?, `updated_at` = NOW() WHERE `id` = ?',
//       ['converted', parsedCartId],
//       tx,
//     );

//     const orders = await sqlQuery<any>(
//       'SELECT * FROM `orders` WHERE `id` = ? LIMIT 1',
//       [orderId],
//       tx,
//     );
//     return orders[0] ?? null;
//   });

//   return result;
// };
async function sendSellerNewOrderMails(orderId: bigint, orderNo: string, grandTotal: number) {
  const rows = await sqlQuery<{
    sellerName: string | null;
    sellerEmail: string | null;
  }>(
    `
    SELECT DISTINCT
      u.name AS sellerName,
      u.email AS sellerEmail
    FROM seller_units su
    JOIN stores s ON s.id = su.store_id
    LEFT JOIN \`User\` u ON u.id = s.seller_user_id
    WHERE su.order_id = ?
    `,
    [orderId],
  );

  for (const seller of rows) {
    if (!seller?.sellerEmail) continue;

    const mailData: {
      sellerName?: string;
      orderNo: string;
      totalAmount: number;
    } = {
      orderNo,
      totalAmount: grandTotal,
    };

    if (seller.sellerName) {
      mailData.sellerName = seller.sellerName;
    }

    void mailServiceAsync({
      to: seller.sellerEmail,
      subject: `New Order Received - ${orderNo}`,
      html: SellerMailTemplate.newOrderReceived(mailData),
      text: `You received a new order ${orderNo}`,
    });
  }
}
async function getBuyerOrderMailInfo(orderId: bigint) {
  const rows = await sqlQuery<{
    customerName: string | null;
    customerEmail: string | null;
    orderNo: string;
  }>(
    `
    SELECT
      u.name AS customerName,
      u.email AS customerEmail,
      o.order_no AS orderNo
    FROM orders o
    JOIN \`User\` u ON u.id = o.user_id
    WHERE o.id = ?
    LIMIT 1
    `,
    [orderId],
  );

  return rows[0] ?? null;
}

async function sendOrderShippedMail(orderId: bigint) {
  const info = await getBuyerOrderMailInfo(orderId);
  if (!info?.customerEmail) return;

  const mailData: {
    customerName?: string;
    orderNo: string;
  } = {
    orderNo: info.orderNo,
  };

  if (info.customerName) {
    mailData.customerName = info.customerName;
  }

  void mailServiceAsync({
    to: info.customerEmail,
    subject: `Order Shipped - ${info.orderNo}`,
    html: BuyerMailTemplate.orderShipped(mailData),
    text: `Your order ${info.orderNo} has been shipped.`,
  });
}

async function sendOrderDeliveredMail(orderId: bigint) {
  const info = await getBuyerOrderMailInfo(orderId);
  if (!info?.customerEmail) return;

  const mailData: {
    customerName?: string;
    orderNo: string;
  } = {
    orderNo: info.orderNo,
  };

  if (info.customerName) {
    mailData.customerName = info.customerName;
  }

  void mailServiceAsync({
    to: info.customerEmail,
    subject: `Order Delivered - ${info.orderNo}`,
    html: BuyerMailTemplate.orderDelivered(mailData),
    text: `Your order ${info.orderNo} has been delivered.`,
  });
}

async function sendRefundProcessedMail(orderId: bigint, refundAmount: string | number) {
  const info = await getBuyerOrderMailInfo(orderId);
  if (!info?.customerEmail) return;

  const mailData: {
    customerName?: string;
    orderNo: string;
    refundAmount: string | number;
  } = {
    orderNo: info.orderNo,
    refundAmount,
  };

  if (info.customerName) {
    mailData.customerName = info.customerName;
  }

  void mailServiceAsync({
    to: info.customerEmail,
    subject: `Refund Processed - ${info.orderNo}`,
    html: BuyerMailTemplate.refundProcessed(mailData),
    text: `Refund processed for order ${info.orderNo}. Amount: ₹${refundAmount}`,
  });
}

export const createOrder = async (userId: number, data: any) => {
  const { cart_id, billing_address, shipping_address, currency = 'INR' } = data;

  const parsedCartId = BigInt(cart_id);

  const cartRows = await sqlQuery<any>('SELECT * FROM `carts` WHERE `id` = ? LIMIT 1', [
    parsedCartId,
  ]);

  const cart = cartRows[0] ?? null;

  if (!cart) throw new Error('Cart not found');

  if (cart.user_id !== null && BigInt(cart.user_id) !== BigInt(userId)) {
    throw new Error('Cart belongs to a different user');
  }

  const items = await sqlQuery<any>(
    'SELECT * FROM `cart_items` WHERE `cart_id` = ? ORDER BY `id` ASC',
    [parsedCartId],
  );

  if (items.length === 0) throw new Error('Cart is empty');

  const subtotal = items.reduce((sum: number, item: any) => {
    return sum + Number(item.qty) * Number(item.price_snapshot);
  }, 0);

  const totalItems = items.reduce((sum: number, item: any) => {
    return sum + Number(item.qty);
  }, 0);

  const taxTotal = Number(data.tax_total ?? 0);
  const shippingTotal = Number(data.shipping_total ?? 0);
  const discountTotal = Number(data.discount_total ?? 0);
  const grandTotal = subtotal + taxTotal + shippingTotal - discountTotal;

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `ORD-${dateStr}-`;
  const tempOrderNo = `TEMP-${Date.now()}`;

  const billingAddress = { ...billing_address, type: 'billing' };
  const finalShippingAddress = shipping_address
    ? { ...shipping_address, type: 'shipping' }
    : { ...billing_address, type: 'shipping' };

  const result = await withSqlTransaction(async (tx) => {
    const orderRes = await sqlExec(
      `INSERT INTO orders
    (
      order_no,
      user_id,
      cart_id,
      order_status,
      total_items,
      subtotal,
      tax_total,
      shipping_total,
      discount_total,
      grand_total,
      total_amount, -- ✅ ADDED
      payment_status,
      currency,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        tempOrderNo,
        userId,
        parsedCartId,
        'CREATED',
        totalItems,
        subtotal,
        taxTotal,
        shippingTotal,
        discountTotal,
        grandTotal,
        grandTotal, // ✅ ADDED
        'PENDING',
        currency,
      ],
      tx,
    );

    const orderId = BigInt(orderRes.insertId as any);
    const finalOrderNo = `${prefix}${String(orderId).padStart(4, '0')}`;

    await sqlExec(
      'UPDATE `orders` SET `order_no` = ?, `updated_at` = NOW() WHERE `id` = ?',
      [finalOrderNo, orderId],
      tx,
    );

    // ✅ Create seller_units FIRST
    const storeIds = [...new Set(items.map((it: any) => String(it.store_id)))];

    const sellerUnitMap = new Map<string, bigint>();

    if (storeIds.length) {
      const storeRows = await sqlQuery<any>(
        `SELECT id, seller_user_id AS sellerUserId
          FROM stores
          WHERE id IN (${storeIds.map(() => '?').join(',')})`,
        storeIds.map((s) => BigInt(s)),
        tx,
      );

      const storeMap = new Map(storeRows.map((s: any) => [String(s.id), s.sellerUserId]));

      for (const sid of storeIds) {
        const sellerUnitRes = await sqlExec(
          `INSERT INTO seller_units
            (
              order_id,
              store_id,
              seller_id,
              status,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, NOW(), NOW())`,
          [orderId, BigInt(sid), storeMap.get(sid) ?? 0, 'pending'],
          tx,
        );

        sellerUnitMap.set(String(sid), BigInt(sellerUnitRes.insertId as any));
      }
    }

    // ✅ Then create order_items with order_seller_unit_id
    // for (const item of items) {
    //   const itemTotal = Number(item.qty) * Number(item.price_snapshot);
    //   const orderSellerUnitId = sellerUnitMap.get(String(item.store_id)) ?? null;

    //   await sqlExec(
    //     `INSERT INTO order_items
    //     (
    //       order_id,
    //       order_seller_unit_id,
    //       product_id,
    //       variant_id,
    //       qty,
    //       price_snapshot,
    //       tax_snapshot,
    //       discount_snapshot,
    //       total_snapshot,
    //       item_status,
    //       created_at,
    //       updated_at
    //     )
    //     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    //     [
    //       orderId,
    //       orderSellerUnitId,
    //       item.product_id,
    //       item.variant_id ?? 0,
    //       item.qty,
    //       item.price_snapshot,
    //       0,
    //       0,
    //       itemTotal,
    //       'pending',
    //     ],
    //     tx,
    //   );
    // }
    for (const item of items) {
      const itemPrice = Number(item.price_snapshot); // ✅ ADDED
      const itemTotal = Number(item.qty) * itemPrice;

      const orderSellerUnitId = sellerUnitMap.get(String(item.store_id)) ?? null;

      await sqlExec(
        `INSERT INTO order_items
      (
        order_id,
        order_seller_unit_id,
        product_id,
        variant_id,
        qty,
        price,             
        total,              
        price_snapshot,
        tax_snapshot,
        discount_snapshot,
        total_snapshot,
         item_status ,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          orderId,
          orderSellerUnitId,
          item.product_id,
          item.variant_id ?? 0,
          item.qty,
          itemPrice, // ✅ ADDED for price
          itemTotal, // ✅ ADDED for total
          itemPrice,
          0,
          0,
          itemTotal,
          'pending',
        ],
        tx,
      );
    }

    // ✅ Address insert without district_id/state_id
    for (const addr of [billingAddress, finalShippingAddress]) {
      await sqlExec(
        `INSERT INTO order_addresses
      (
        order_id,
        type,
        full_name,
        phone,
        address_line1,
        address_line2,
        city,
        state,
        country,
        pincode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          addr.type,
          addr.full_name,
          addr.phone,
          addr.address_line1,
          addr.address_line2 ?? null,
          addr.city,
          addr.state,
          addr.country ?? 'India',
          addr.pincode,
        ],
        tx,
      );
    }

    await sqlExec('DELETE FROM cart_items WHERE cart_id = ?', [parsedCartId], tx);

    await sqlExec(
      'UPDATE carts SET status = ?, updated_at = NOW() WHERE id = ?',
      ['converted', parsedCartId],
      tx,
    );

    const orders = await sqlQuery<any>('SELECT * FROM orders WHERE id = ? LIMIT 1', [orderId], tx);

    return orders[0] ?? null;
  });
  const userRows = await sqlQuery<{
    name: string;
    email: string | null;
  }>('SELECT `name`, `email` FROM `User` WHERE `id` = ? LIMIT 1', [userId]);

  const user = userRows[0] ?? null;

  if (user?.email && result?.order_no) {
    void mailServiceAsync({
      to: user.email,
      subject: `Order Placed - ${result.order_no}`,
      html: BuyerMailTemplate.orderPlaced({
        customerName: user.name,
        orderNo: result.order_no,
        amount: result.grand_total ?? result.total_amount ?? 0,
      }),
      text: `Your order ${result.order_no} has been placed successfully.`,
    });
  }
  if (result?.id && result?.order_no) {
    void sendSellerNewOrderMails(
      BigInt(result.id),
      result.order_no,
      Number(result.grand_total ?? result.total_amount ?? 0),
    );
  }

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
    await sqlExec(
      'UPDATE `orders` SET `status` = ?, `updated_at` = NOW() WHERE `id` = ?',
      ['cancelled', order.id],
      tx,
    );
    await sqlExec(
      'UPDATE `order_items` SET `item_status` = ?, `updated_at` = NOW() WHERE `order_id` = ?',
      ['cancelled', order.id],
      tx,
    );
    await sqlExec(
      'UPDATE `seller_units` SET `status` = ?, `updated_at` = NOW() WHERE `order_id` = ?',
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
  const userRows = await sqlQuery<{
    name: string;
    email: string | null;
  }>('SELECT `name`, `email` FROM `User` WHERE `id` = ? LIMIT 1', [userId]);

  const user = userRows[0] ?? null;

  if (user?.email && result?.order_no) {
    void mailServiceAsync({
      to: user.email,
      subject: `Order Cancelled - ${result.order_no}`,
      html: BuyerMailTemplate.orderCancelled({
        customerName: user.name,
        orderNo: result.order_no,
      }),
      text: `Your order ${result.order_no} has been cancelled.`,
    });
  }
  if (result?.id && result?.order_no) {
    const sellers = await sqlQuery<{
      sellerName: string | null;
      sellerEmail: string | null;
    }>(
      `
    SELECT DISTINCT
      u.name AS sellerName,
      u.email AS sellerEmail
    FROM seller_units su
    JOIN stores s ON s.id = su.store_id
    LEFT JOIN \`User\` u ON u.id = s.seller_user_id
    WHERE su.order_id = ?
    `,
      [BigInt(result.id)],
    );

    for (const seller of sellers) {
      if (!seller?.sellerEmail) continue;

      const mailData: {
        sellerName?: string;
        orderNo: string;
      } = {
        orderNo: result.order_no,
      };

      if (seller.sellerName) {
        mailData.sellerName = seller.sellerName;
      }

      void mailServiceAsync({
        to: seller.sellerEmail,
        subject: `Order Cancelled - ${result.order_no}`,
        html: SellerMailTemplate.orderCancelledByBuyer(mailData),
        text: `Order ${result.order_no} has been cancelled by buyer.`,
      });
    }
  }
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
      'INSERT INTO `returns` (`order_id`, `order_item_id`, `reason`, `refund_amount`, `refund_mode`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [order.id, orderItem.id, reason, Number(refund_amount), refund_mode, 'pending'],
      tx,
    );
    await sqlExec(
      'UPDATE `order_items` SET `item_status` = ?, `updated_at` = NOW() WHERE `id` = ?',
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
  const sellers = await sqlQuery<{
    sellerName: string | null;
    sellerEmail: string | null;
  }>(
    `
  SELECT DISTINCT
    u.name AS sellerName,
    u.email AS sellerEmail
  FROM seller_units su
  JOIN stores s ON s.id = su.store_id
  LEFT JOIN \`User\` u ON u.id = s.seller_user_id
  WHERE su.order_id = ?
  `,
    [order.id],
  );

  for (const seller of sellers) {
    if (!seller?.sellerEmail) continue;

    const mailData: {
      sellerName?: string;
      orderNo: string;
    } = {
      orderNo: order.order_no,
    };

    if (seller.sellerName) {
      mailData.sellerName = seller.sellerName;
    }

    void mailServiceAsync({
      to: seller.sellerEmail,
      subject: `Return Request - ${order.order_no}`,
      html: SellerMailTemplate.returnRequestReceived(mailData),
      text: `A return request was created for ${order.order_no}`,
    });
  }
  return result;
};
