import { sqlExec, sqlQuery } from '~/lib/sql';

type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REJECTED';

type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

const generateTicketNo = () => {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const random = Math.floor(1000 + Math.random() * 9000);

  return `TKT-${year}${month}${day}-${random}`;
};

export const createTicket = async (payload: {
  userId: number;
  orderId: number;
  orderItemId?: number | null;
  orderSellerUnitId?: number | null;
  reasonCode: string;
  reasonText?: string | null;
  comment: string;
  priority?: TicketPriority;
}) => {
  const ticketNo = generateTicketNo();

  let storeId: number | null = null;
  let sellerUserId: number | null = null;

  if (payload.orderItemId) {
    const itemRows: any[] = await sqlQuery(
      `
    SELECT 
      oi.id AS order_item_id,
      oi.order_id,
      oi.order_seller_unit_id,
      oi.product_id,
      p.store_id,
      s.seller_user_id
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN stores s ON s.id = p.store_id
    WHERE oi.id = ?
      AND oi.order_id = ?
    LIMIT 1
    `,
      [payload.orderItemId, payload.orderId],
    );

    if (itemRows.length) {
      storeId = itemRows[0].store_id || null;
      sellerUserId = itemRows[0].seller_user_id || null;
    }
  }

  const result: any = await sqlExec(
    `
    INSERT INTO support_tickets
    (
      ticket_no,
      user_id,
      order_id,
      order_item_id,
      order_seller_unit_id,
      seller_user_id,
      store_id,
      reason_code,
      reason_text,
      comment,
      status,
      priority,
      last_message_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, NOW(), NOW(), NOW())
    `,
    [
      ticketNo,
      payload.userId,
      payload.orderId,
      payload.orderItemId || null,
      payload.orderSellerUnitId || null,
      sellerUserId,
      storeId,
      payload.reasonCode,
      payload.reasonText || null,
      payload.comment,
      payload.priority || 'MEDIUM',
    ],
  );

  const ticketId = Number(result.insertId);

  await sqlExec(
    `
    INSERT INTO support_ticket_messages
    (
      ticket_id,
      sender_user_id,
      sender_role,
      message,
      created_at
    )
    VALUES (?, ?, 'USER', ?, NOW())
    `,
    [ticketId, payload.userId, payload.comment],
  );

  await sqlExec(
    `
    INSERT INTO support_ticket_status_history
    (
      ticket_id,
      old_status,
      new_status,
      changed_by_user_id,
      note,
      created_at
    )
    VALUES (?, NULL, 'OPEN', ?, 'Ticket created', NOW())
    `,
    [ticketId, payload.userId],
  );

  return getTicketById(ticketId);
};

export const getTicketById = async (id: number) => {
  const tickets: any[] = await sqlQuery(
    `
    SELECT 
      st.*,
      o.order_no,
      u.name AS customer_name,
      u.email AS customer_email,
      u.phoneNumber AS customer_phone,
      s.store_name
    FROM support_tickets st
    LEFT JOIN orders o ON o.id = st.order_id
    LEFT JOIN user u ON u.id = st.user_id
    LEFT JOIN stores s ON s.id = st.store_id
    WHERE st.id = ?
    LIMIT 1
    `,
    [id],
  );

  const ticket = tickets[0] ?? null;

  if (!ticket) return null;

  const messages = await sqlQuery(
    `
    SELECT *
    FROM support_ticket_messages
    WHERE ticket_id = ?
    ORDER BY created_at ASC
    `,
    [id],
  );

  const history = await sqlQuery(
    `
    SELECT *
    FROM support_ticket_status_history
    WHERE ticket_id = ?
    ORDER BY created_at ASC
    `,
    [id],
  );

  return {
    ...ticket,
    messages,
    history,
  };
};

export const getMyTickets = async (userId: number) => {
  return sqlQuery(
    `
    SELECT 
      st.*,
      o.order_no,
      s.store_name
    FROM support_tickets st
    LEFT JOIN orders o ON o.id = st.order_id
    LEFT JOIN stores s ON s.id = st.store_id
    WHERE st.user_id = ?
    ORDER BY st.created_at DESC
    `,
    [userId],
  );
};

export const getSellerTickets = async (sellerUserId: number) => {
  return sqlQuery(
    `
    SELECT 
      st.*,
      o.order_no,
      u.name AS customer_name,
      u.phoneNumber AS customer_phone,
      s.store_name
    FROM support_tickets st
    LEFT JOIN orders o ON o.id = st.order_id
    LEFT JOIN user u ON u.id = st.user_id
    LEFT JOIN stores s ON s.id = st.store_id
    WHERE st.seller_user_id = ?
    ORDER BY st.created_at DESC
    `,
    [sellerUserId],
  );
};

export const getAllTickets = async () => {
  return sqlQuery(
    `
    SELECT 
      st.*,
      o.order_no,
      u.name AS customer_name,
      u.phoneNumber AS customer_phone,
      s.store_name
    FROM support_tickets st
    LEFT JOIN orders o ON o.id = st.order_id
    LEFT JOIN user u ON u.id = st.user_id
    LEFT JOIN stores s ON s.id = st.store_id
    ORDER BY st.created_at DESC
    `,
  );
};

// export const addTicketMessage = async (payload: {
//   ticketId: number;
//   senderUserId: number;
//   senderRole: string;
//   message: string;
// }) => {
//   const result: any = await sqlExec(
//     `
//     INSERT INTO support_ticket_messages
//     (
//       ticket_id,
//       sender_user_id,
//       sender_role,
//       message,
//       created_at
//     )
//     VALUES (?, ?, ?, ?, NOW())
//     `,
//     [payload.ticketId, payload.senderUserId, payload.senderRole, payload.message],
//   );

//   await sqlExec(
//     `
//     UPDATE support_tickets
//     SET last_message_at = NOW()
//     WHERE id = ?
//     `,
//     [payload.ticketId],
//   );

//   const rows: any[] = await sqlQuery(
//     `
//     SELECT *
//     FROM support_ticket_messages
//     WHERE id = ?
//     LIMIT 1
//     `,
//     [result.insertId],
//   );

//   return rows[0] ?? null;
// };

export const addTicketMessage = async (payload: {
  ticketId: number;
  senderUserId: number;
  senderRole: string;
  message: string;
}) => {
  // ✅ Permission check
  const ticketRows: any[] = await sqlQuery(
    `
    SELECT id, user_id, seller_user_id
    FROM support_tickets
    WHERE id = ?
    LIMIT 1
    `,
    [payload.ticketId],
  );

  const ticket = ticketRows[0];

  if (!ticket) {
    throw new Error('Ticket not found');
  }

  const role = String(payload.senderRole || '').toUpperCase();

  const isCustomer = role === 'USER' && Number(ticket.user_id) === Number(payload.senderUserId);

  const isSeller =
    role === 'SELLER' && Number(ticket.seller_user_id) === Number(payload.senderUserId);

  const isAdmin = role === 'ADMIN';

  if (!isCustomer && !isSeller && !isAdmin) {
    throw new Error('You are not allowed to chat on this ticket');
  }

  // ✅ Insert message
  const result: any = await sqlExec(
    `
    INSERT INTO support_ticket_messages
    (
      ticket_id,
      sender_user_id,
      sender_role,
      message,
      created_at
    )
    VALUES (?, ?, ?, ?, NOW())
    `,
    [payload.ticketId, payload.senderUserId, role, payload.message],
  );

  await sqlExec(
    `
    UPDATE support_tickets
    SET last_message_at = NOW()
    WHERE id = ?
    `,
    [payload.ticketId],
  );

  const rows: any[] = await sqlQuery(
    `
    SELECT *
    FROM support_ticket_messages
    WHERE id = ?
    LIMIT 1
    `,
    [result.insertId],
  );

  return rows[0] ?? null;
};

export const updateTicketStatus = async (payload: {
  ticketId: number;
  status: TicketStatus;
  changedByUserId: number;
  note?: string | null;
}) => {
  const oldRows: any[] = await sqlQuery(
    `
    SELECT status
    FROM support_tickets
    WHERE id = ?
    LIMIT 1
    `,
    [payload.ticketId],
  );

  const oldStatus = oldRows[0]?.status || null;

  await sqlExec(
    `
    UPDATE support_tickets
    SET 
      status = ?,
      resolved_at = CASE WHEN ? = 'RESOLVED' THEN NOW() ELSE resolved_at END,
      closed_at = CASE WHEN ? IN ('CLOSED', 'REJECTED') THEN NOW() ELSE closed_at END
    WHERE id = ?
    `,
    [payload.status, payload.status, payload.status, payload.ticketId],
  );

  await sqlExec(
    `
    INSERT INTO support_ticket_status_history
    (
      ticket_id,
      old_status,
      new_status,
      changed_by_user_id,
      note,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, NOW())
    `,
    [payload.ticketId, oldStatus, payload.status, payload.changedByUserId, payload.note || null],
  );

  return getTicketById(payload.ticketId);
};

export const resolveTicket = async (
  ticketId: number,
  sellerUserId: number,
  resolutionNote: string,
) => {
  const oldRows: any[] = await sqlQuery(
    `
    SELECT status
    FROM support_tickets
    WHERE id = ? AND seller_user_id = ?
    LIMIT 1
    `,
    [ticketId, sellerUserId],
  );

  if (!oldRows.length) {
    return null;
  }

  const oldStatus = oldRows[0].status;

  await sqlExec(
    `
    UPDATE support_tickets
    SET 
      status = 'RESOLVED',
      resolution_note = ?,
      resolved_at = NOW()
    WHERE id = ?
      AND seller_user_id = ?
    `,
    [resolutionNote, ticketId, sellerUserId],
  );

  await sqlExec(
    `
    INSERT INTO support_ticket_status_history
    (
      ticket_id,
      old_status,
      new_status,
      changed_by_user_id,
      note,
      created_at
    )
    VALUES (?, ?, 'RESOLVED', ?, ?, NOW())
    `,
    [ticketId, oldStatus, sellerUserId, resolutionNote],
  );

  return getTicketById(ticketId);
};

export const rejectTicket = async (
  ticketId: number,
  sellerUserId: number,
  resolutionNote: string,
) => {
  const oldRows: any[] = await sqlQuery(
    `
    SELECT status
    FROM support_tickets
    WHERE id = ? AND seller_user_id = ?
    LIMIT 1
    `,
    [ticketId, sellerUserId],
  );

  if (!oldRows.length) {
    return null;
  }

  const oldStatus = oldRows[0].status;

  await sqlExec(
    `
    UPDATE support_tickets
    SET 
      status = 'REJECTED',
      resolution_note = ?,
      closed_at = NOW()
    WHERE id = ?
      AND seller_user_id = ?
    `,
    [resolutionNote, ticketId, sellerUserId],
  );

  await sqlExec(
    `
    INSERT INTO support_ticket_status_history
    (
      ticket_id,
      old_status,
      new_status,
      changed_by_user_id,
      note,
      created_at
    )
    VALUES (?, ?, 'REJECTED', ?, ?, NOW())
    `,
    [ticketId, oldStatus, sellerUserId, resolutionNote],
  );

  return getTicketById(ticketId);
};

export const closeTicket = async (ticketId: number, userId: number, note?: string | null) => {
  const oldRows: any[] = await sqlQuery(
    `
    SELECT status
    FROM support_tickets
    WHERE id = ?
    LIMIT 1
    `,
    [ticketId],
  );

  if (!oldRows.length) {
    return null;
  }

  const oldStatus = oldRows[0].status;

  await sqlExec(
    `
    UPDATE support_tickets
    SET 
      status = 'CLOSED',
      closed_at = NOW()
    WHERE id = ?
    `,
    [ticketId],
  );

  await sqlExec(
    `
    INSERT INTO support_ticket_status_history
    (
      ticket_id,
      old_status,
      new_status,
      changed_by_user_id,
      note,
      created_at
    )
    VALUES (?, ?, 'CLOSED', ?, ?, NOW())
    `,
    [ticketId, oldStatus, userId, note || null],
  );

  return getTicketById(ticketId);
};
