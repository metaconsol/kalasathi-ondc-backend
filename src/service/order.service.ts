import { db } from '../lib/db';
import { Prisma } from '../generated/prisma/client';

export const createOrder = async (userId: number, data: any) => {
  const { cart_id, billing_address, shipping_address, currency = 'INR' } = data;

  const parsedCartId = BigInt(cart_id);

  // Validate Cart
  const cart = await db.cart.findUnique({
    where: {
      id: parsedCartId,
    },
    include: {
      items: true,
    },
  });

  if (!cart) {
    throw new Error('Cart not found');
  }

  if (cart.userId !== null && cart.userId !== BigInt(userId)) {
    throw new Error(
      `Cart belongs to a different user. cart.userId=${cart.userId}, userId=${userId}, cartId=${parsedCartId}`,
    );
  }

  if (cart.items.length === 0) {
    throw new Error('Cart is empty');
  }

  // Calculate total amount
  let totalAmount = 0;
  cart.items.forEach((item) => {
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
  const result = await db.$transaction(async (tx: any) => {
    // 1. Create Order with temp order_no
    let order = await tx.order.create({
      data: {
        order_no: temp_order_no,
        user_id: userId,
        cart_id: parsedCartId,
        status: 'pending',
        payment_status: 'pending',
        currency,
        total_amount: totalAmount,
      },
    });

    // Combine prefix and padded auto-increment DB ID (e.g. ORD-20260425-0001)
    const final_order_no = `${prefix}${String(order.id).padStart(4, '0')}`;

    // Update the record with the final order_no instantly
    order = await tx.order.update({
      where: { id: order.id },
      data: { order_no: final_order_no },
    });

    // 2. Create OrderItems
    const orderItemsData = cart.items.map((item) => ({
      order_id: order.id,
      product_id: item.productId,
      variant_id: item.variantId,
      qty: item.qty,
      price: item.priceSnapshot,
      total: item.qty * Number(item.priceSnapshot),
      item_status: 'pending',
    }));

    await tx.orderItem.createMany({
      data: orderItemsData,
    });

    // 3. Create Addresses
    await tx.orderAddress.createMany({
      data: [
        {
          order_id: order.id,
          type: billingAddress.type,
          full_name: billingAddress.full_name,
          phone: billingAddress.phone,
          address_line1: billingAddress.address_line1,
          address_line2: billingAddress.address_line2,
          city: billingAddress.city,
          district_id: billingAddress.city_id,
          state: billingAddress.state,
          state_id: billingAddress.state_id,
          country: billingAddress.country,
          pincode: billingAddress.pincode,
        },
        {
          order_id: order.id,
          type: shippingAddress.type,
          full_name: shippingAddress.full_name,
          phone: shippingAddress.phone,
          address_line1: shippingAddress.address_line1,
          address_line2: shippingAddress.address_line2,
          city: shippingAddress.city,
          district_id: shippingAddress.city_id,
          state: shippingAddress.state,
          state_id: shippingAddress.state_id,
          country: shippingAddress.country,
          pincode: shippingAddress.pincode,
        },
      ],
    });

    // 4. Group items by store_id
    const storeIds = [...new Set(cart.items.map((item) => item.storeId.toString()))];

    // For each store, we need seller_id
    // Fetch stores to get seller_id
    const stores = await tx.store.findMany({
      where: { id: { in: storeIds.map((id) => BigInt(id)) } },
    });

    const storeMap = new Map();
    stores.forEach((s: any) => storeMap.set(s.id.toString(), s.sellerUserId));

    const sellerUnitsData = storeIds.map((storeIdStr) => ({
      order_id: order.id,
      store_id: BigInt(storeIdStr),
      seller_id: storeMap.get(storeIdStr) || 0,
      status: 'pending',
    }));

    await tx.sellerUnit.createMany({
      data: sellerUnitsData,
    });

    // 5. Clear cart (Assuming clear means delete items and make status converted)
    await tx.cartItem.deleteMany({
      where: { cartId: parsedCartId },
    });
    await tx.cart.update({
      where: { id: parsedCartId },
      data: { status: 'converted' },
    });

    return order;
  });

  return result;
};

export const listOrders = async (userId: number, filters: any) => {
  const { status, payment_status, page, limit } = filters;

  const where: any = { user_id: userId };
  if (status) where.status = status;
  if (payment_status) where.payment_status = payment_status;

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    db.order.findMany({
      where,
      skip,
      take: limit,
      orderBy: { created_at: 'desc' },
    }),
    db.order.count({ where }),
  ]);

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
  const whereCl: any = { user_id: userId };

  if (isNumeric) {
    whereCl.id = BigInt(idOrNo);
  } else {
    whereCl.order_no = idOrNo;
  }

  const order = await db.order.findFirst({
    where: whereCl,
    include: {
      items: true,
      addresses: true,
      seller_units: true,
    },
  });

  return order;
};

export const cancelOrder = async (userId: number, id: string, note?: string) => {
  const isNumeric = /^\d+$/.test(id);
  const whereCl: any = { user_id: userId };
  if (isNumeric) whereCl.id = BigInt(id);
  else whereCl.order_no = id;

  const order = await db.order.findFirst({
    where: whereCl,
  });

  if (!order) {
    throw new Error('Order not found');
  }

  if (order.status !== 'pending' && order.status !== 'confirmed') {
    throw new Error('Cannot cancel order because it is not in pending or confirmed state');
  }

  const result = await db.$transaction(async (tx: any) => {
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { status: 'cancelled' }, // Could store note in adminNotes or a separate column if it existed
    });

    await tx.orderItem.updateMany({
      where: { order_id: order.id },
      data: { item_status: 'cancelled' },
    });

    // Also update seller_units
    await tx.sellerUnit.updateMany({
      where: { order_id: order.id },
      data: { status: 'cancelled' },
    });

    return updatedOrder;
  });

  return result;
};

export const orderTracking = async (userId: number, id: string) => {
  const isNumeric = /^\d+$/.test(id);
  const whereCl: any = { user_id: userId };
  if (isNumeric) whereCl.id = BigInt(id);
  else whereCl.order_no = id;

  const order = await db.order.findFirst({
    where: whereCl,
    include: {
      seller_units: {
        select: {
          id: true,
          tracking_no: true,
          logistics_provider: true,
          status: true,
        },
      },
    },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  return { seller_units: order.seller_units };
};

export const listReturns = async (userId: number, id: string) => {
  const isNumeric = /^\d+$/.test(id);
  const whereCl: any = { user_id: userId };
  if (isNumeric) whereCl.id = BigInt(id);
  else whereCl.order_no = id;

  const order = await db.order.findFirst({
    where: whereCl,
  });

  if (!order) {
    throw new Error('Order not found');
  }

  const returns = await db.return.findMany({
    where: { order_id: order.id },
    orderBy: { created_at: 'desc' },
  });

  return returns;
};

export const requestReturn = async (userId: number, id: string, data: any) => {
  const { order_item_id, reason, refund_amount, refund_mode } = data;

  const isNumeric = /^\d+$/.test(id);
  const whereCl: any = { user_id: userId };
  if (isNumeric) whereCl.id = BigInt(id);
  else whereCl.order_no = id;

  const order = await db.order.findFirst({
    where: whereCl,
  });

  if (!order) {
    throw new Error('Order not found');
  }

  const orderItem = await db.orderItem.findFirst({
    where: {
      id: BigInt(order_item_id),
      order_id: order.id,
    },
  });

  if (!orderItem) {
    throw new Error('Order Item not found or does not belong to this order');
  }

  if (orderItem.item_status !== 'delivered') {
    throw new Error('Can only return delivered items');
  }

  const result = await db.$transaction(async (tx: any) => {
    const returnReq = await tx.return.create({
      data: {
        order_id: order.id,
        order_item_id: orderItem.id,
        reason,
        refund_amount: Number(refund_amount),
        refund_mode,
        status: 'pending', // pending initially
      },
    });

    await tx.orderItem.update({
      where: { id: orderItem.id },
      data: { item_status: 'returned' },
    });

    return returnReq;
  });

  return result;
};
