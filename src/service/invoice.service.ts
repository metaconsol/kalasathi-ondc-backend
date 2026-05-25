import { sqlExec, sqlQuery } from '~/lib/sql';
import { buildObjectKey, putS3Object, resolveS3KeyToUrl } from '~/lib/s3';

export const generateSellerInvoice = async (sellerId: number, sellerUnitId: string) => {
  const PDFDocument = (await import('pdfkit')).default;
  const path = await import('path');
  const fs = await import('fs');

  const rows = await sqlQuery<any>(
    `
    SELECT
      su.id AS seller_unit_id,
      su.status AS seller_order_status,

      o.id AS order_id,
      o.order_no,
      o.created_at,
      o.payment_status,
      o.currency,
      o.grand_total,
      o.shipping_total,

      s.store_name,
      s.support_email,
      s.support_phone,

      sl.address_line1 AS store_address_line1,
sl.address_line2 AS store_address_line2,
sl.city AS store_city,
sl.state AS store_state,
sl.country AS store_country,
sl.pincode AS store_pincode,

      ba.full_name AS billing_full_name,
ba.phone AS billing_phone,
ba.address_line1 AS billing_address_line1,
ba.address_line2 AS billing_address_line2,
ba.city AS billing_city,
ba.state AS billing_state,
ba.country AS billing_country,
ba.pincode AS billing_pincode,

sa.full_name AS shipping_full_name,
sa.phone AS shipping_phone,
sa.address_line1 AS shipping_address_line1,
sa.address_line2 AS shipping_address_line2,
sa.city AS shipping_city,
sa.state AS shipping_state,
sa.country AS shipping_country,
sa.pincode AS shipping_pincode

    FROM seller_units su
    JOIN orders o ON o.id = su.order_id
    JOIN stores s ON s.id = su.store_id

    LEFT JOIN store_locations sl
  ON sl.store_id = s.id
  AND sl.location_type = 'SELF_PICKUP'
  AND sl.is_active = 1

    LEFT JOIN order_addresses ba
  ON ba.order_id = o.id
  AND ba.type = 'billing'

LEFT JOIN order_addresses sa
  ON sa.order_id = o.id
  AND sa.type = 'shipping'

    WHERE su.id = ? AND su.seller_id = ?
    LIMIT 1
    `,
    [BigInt(sellerUnitId), sellerId],
  );

  const order = rows[0] ?? null;

  if (!order) {
    throw new Error('Seller order not found');
  }

  const items = await sqlQuery<any>(
    `
    SELECT
      oi.qty,
      oi.price_snapshot,
      oi.tax_snapshot,
      oi.total_snapshot,

      p.product_name,
      p.hsn_sac_code,
      p.gst_percent

    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id

    WHERE oi.order_seller_unit_id = ?
    `,
    [BigInt(sellerUnitId)],
  );

  const fileName = `order-${order.order_no}.pdf`;

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
  });

  // Collect PDF into buffer
  const buffers: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => buffers.push(chunk));

  // We'll await the finish event later instead of using a stream

  const leftX = 40;
  const rightX = 320;
  const pageRight = 555;

  const formatDate = (date: string | Date) => new Date(date).toLocaleDateString('en-IN');

  const money = (value: any) => `Rs. ${Number(value || 0).toFixed(2)}`;

  // HEADER
  // doc.font('Helvetica-Bold').fontSize(20).text('TAX INVOICE', 0, 45, {
  //   align: 'center',
  // });
  const logoPath = path.join(process.cwd(), 'public', 'uploads', 'odop-logo.jpeg');

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, leftX, 45, {
      width: 140,
    });
  }

  doc.font('Helvetica-Bold').fontSize(18).text('Invoice', 430, 55, {
    width: 120,
    align: 'right',
  });

  doc.font('Helvetica').fontSize(9).text('(Original for Recipient)', 390, 78, {
    width: 160,
    align: 'right',
  });

  // SOLD BY
  let soldByY = 125;

  doc.fontSize(10).font('Helvetica-Bold').text('Sold By :', leftX, soldByY);

  soldByY += 18;

  doc.fontSize(10).font('Helvetica');

  doc.text(order.store_name || '-', leftX, soldByY, {
    width: 230,
  });

  soldByY += 20;

  doc.text(`${order.store_address_line1 || '-'}`, leftX, soldByY, {
    width: 230,
  });

  soldByY += 16;

  if (order.store_address_line2) {
    doc.text(`${order.store_address_line2}`, leftX, soldByY, {
      width: 230,
    });

    soldByY += 16;
  }

  doc.text(
    [order.store_city, order.store_state, order.store_country, order.store_pincode]
      .filter(Boolean)
      .join(', '),
    leftX,
    soldByY,
    {
      width: 230,
    },
  );
  soldByY += 20;
  doc.text(order.support_email || '-', leftX, soldByY, {
    width: 230,
  });

  soldByY += 16;

  doc.text(order.support_phone || '-', leftX, soldByY, {
    width: 230,
  });

  soldByY += 22;

  // BILLING ADDRESS
  doc.fontSize(10).font('Helvetica-Bold').text('Billing Address :', rightX, 125);
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(order.billing_full_name || '-', rightX, 142, {
      width: 220,
    });
  doc.text(order.billing_address_line1 || '-', rightX, 158, { width: 220 });

  let billingY = 174;
  if (order.billing_address_line2) {
    doc.text(order.billing_address_line2, rightX, billingY, { width: 220 });
    billingY += 16;
  }

  doc.text(
    `${order.billing_city || '-'}, ${order.billing_state || '-'} ${order.billing_pincode || ''}`,
    rightX,
    billingY,
    { width: 220 },
  );
  doc.text(`Phone: ${order.billing_phone || '-'}`, rightX, billingY + 16, {
    width: 220,
  });

  // SHIPPING ADDRESS
  doc.fontSize(10).font('Helvetica-Bold').text('Shipping Address :', rightX, 255);
  doc
    .fontSize(10)
    .font('Helvetica')
    .text(order.shipping_full_name || '-', rightX, 272, {
      width: 220,
    });
  doc.text(order.shipping_address_line1 || '-', rightX, 288, { width: 220 });

  let shippingY = 304;
  if (order.shipping_address_line2) {
    doc.text(order.shipping_address_line2, rightX, shippingY, { width: 220 });
    shippingY += 16;
  }

  doc.text(
    `${order.shipping_city || '-'}, ${order.shipping_state || '-'} ${order.shipping_pincode || ''}`,
    rightX,
    shippingY,
    { width: 220 },
  );
  doc.text(`Phone: ${order.shipping_phone || '-'}`, rightX, shippingY + 16, {
    width: 220,
  });

  // META
  doc.fontSize(10).font('Helvetica');
  doc.text(`Order Date: ${formatDate(order.created_at)}`, leftX, 400);
  doc.text(`Order Number: ${order.order_no}`, leftX, 416, { width: 240 });

  doc.text(`Invoice Date: ${formatDate(new Date())}`, rightX, 400);
  doc.text(`Invoice Number: ${order.order_no}`, rightX, 416, { width: 220 });

  // TABLE HEADER
  const tableTop = 465;

  doc.rect(leftX, tableTop, 515, 38).fill('#f2f2f2');
  doc.fillColor('black').fontSize(8).font('Helvetica-Bold');

  doc.text('Description', 48, tableTop + 12, { width: 165 });
  doc.text('HSN', 220, tableTop + 12, { width: 45 });
  doc.text('Qty', 270, tableTop + 12, { width: 30 });
  doc.text('Gross', 310, tableTop + 12, { width: 55 });
  doc.text('GST %', 370, tableTop + 12, { width: 45 });
  doc.text('GST Amt', 420, tableTop + 12, { width: 60 });
  doc.text('Total', 490, tableTop + 12, { width: 60, align: 'right' });

  doc
    .moveTo(leftX, tableTop + 38)
    .lineTo(pageRight, tableTop + 38)
    .stroke();

  let y = tableTop + 52;

  let totalQty = 0;
  let grossTotal = 0;
  let gstTotal = 0;
  let grandTotal = 0;

  items.forEach((item: any) => {
    const qty = Number(item.qty || 0);
    const total = Number(item.total_snapshot || 0);
    const gstPercent = Number(item.gst_percent || 0);

    const taxable = gstPercent > 0 ? total / (1 + gstPercent / 100) : total;
    const gstAmt = total - taxable;

    const halfGstPercent = gstPercent / 2;
    const halfGstAmt = gstAmt / 2;

    totalQty += qty;
    grossTotal += taxable;
    gstTotal += gstAmt;
    grandTotal += total;

    if (y > 720) {
      doc.addPage();
      y = 60;
    }

    doc.fontSize(8).font('Helvetica');

    doc.text(item.product_name || '-', 48, y, { width: 165 });
    doc.text(item.hsn_sac_code || '-', 220, y, { width: 45 });
    doc.text(String(qty), 270, y, { width: 30 });
    doc.text(money(taxable), 310, y, { width: 55 });

    doc.text(`CGST ${halfGstPercent}%\nSGST ${halfGstPercent}%`, 370, y, { width: 45 });

    doc.text(`${money(halfGstAmt)}\n${money(halfGstAmt)}`, 420, y, { width: 60 });

    doc.text(money(total), 490, y, { width: 60, align: 'right' });

    y += 45;
  });

  doc
    .moveTo(leftX, y + 10)
    .lineTo(pageRight, y + 10)
    .stroke();

  y += 25;

  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('Total', 48, y, { width: 165 });
  doc.text(String(totalQty), 270, y, { width: 30 });
  doc.text(money(grossTotal), 310, y, { width: 55 });
  doc.text(money(gstTotal), 420, y, { width: 60 });
  doc.text(money(grandTotal), 490, y, { width: 60, align: 'right' });

  doc
    .moveTo(leftX, y + 25)
    .lineTo(pageRight, y + 25)
    .stroke();

  y += 70;

  const shippingTotal = Number(order.shipping_total || 0);

  doc.fontSize(11).font('Helvetica-Bold');
  doc.text(`Shipping Charges : ${money(shippingTotal)}`, 350, y, {
    width: 200,
    align: 'right',
  });

  doc.text(`Grand Total : ${money(grandTotal + shippingTotal)}`, 350, y + 32, {
    width: 200,
    align: 'right',
  });

  const pdfBufferPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
    doc.on('error', reject);
  });

  doc.end();

  const pdfBuffer = await pdfBufferPromise;

  // Upload to S3
  const objectKey = buildObjectKey('uploads/invoices', fileName);
  await putS3Object(objectKey, pdfBuffer, 'application/pdf');

  const invoiceUrl = await resolveS3KeyToUrl(objectKey);

  await sqlExec(
    `
    UPDATE orders
    SET invoice_url = ?, updated_at = NOW()
    WHERE id = ?
    `,
    [invoiceUrl, order.order_id],
  );

  return {
    filePath: invoiceUrl,
    orderNo: order.order_no,
  };
};
