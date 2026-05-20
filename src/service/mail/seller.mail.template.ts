import { MailTemplate } from './mail.template';

export class SellerMailTemplate extends MailTemplate {
  static sellerWelcome(name?: string) {
    const template = {
      title: `Welcome Seller${name ? `, ${name}` : ''}!`,
      subtitle: 'Start selling with ODOP Mart',
      content: `
        <p>Your seller account has been verified successfully.</p>
        <p>You can now complete your profile, create your store, and start listing your products.</p>
      `,
      buttonText: 'Go to Seller Dashboard',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static sellerProfileSubmitted(name?: string) {
    const template = {
      title: 'KYC Submitted Successfully',
      subtitle: 'Your seller profile is under review',
      content: `
        <p>Hello ${name || 'Seller'},</p>
        <p>Your seller KYC/profile details have been submitted successfully.</p>
        <p>Our team will review your details and update your verification status shortly.</p>
      `,
      buttonText: 'View Dashboard',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static storeCreated(data: { sellerName?: string; storeName: string }) {
    const template = {
      title: 'Store Created Successfully',
      subtitle: 'Your ODOP Mart store is ready',
      content: `
        <p>Hello ${data.sellerName || 'Seller'},</p>
        <p>Your store has been created successfully.</p>
        <p><strong>Store Name:</strong> ${data.storeName}</p>
        <p>You can now start adding products and managing your business.</p>
      `,
      buttonText: 'Manage Store',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
  static productSubmitted(data: { sellerName?: string; productName: string }) {
    const template = {
      title: 'Product Submitted Successfully',
      subtitle: 'Your product is under review',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>
      <p>Your product has been submitted successfully for approval.</p>
      <p><strong>Product:</strong> ${data.productName}</p>
      <p>Our team will review and publish it shortly.</p>
    `,
      buttonText: 'View Products',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static productApproved(data: { sellerName?: string; productName: string }) {
    const template = {
      title: 'Product Approved',
      subtitle: 'Your product is now live',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        Your product has been approved successfully.
      </p>

      <p>
        <strong>Product:</strong> ${data.productName}
      </p>

      <p>
        Customers can now discover and purchase it on ODOP Mart.
      </p>
    `,
      buttonText: 'Manage Products',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static productRejected(data: { sellerName?: string; productName: string; reason?: string }) {
    const template = {
      title: 'Product Rejected',
      subtitle: 'Your product needs changes',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        Your product could not be approved.
      </p>

      <p>
        <strong>Product:</strong> ${data.productName}
      </p>

      ${
        data.reason
          ? `
          <p>
            <strong>Reason:</strong> ${data.reason}
          </p>
        `
          : ''
      }

      <p>
        Please update the product and resubmit it.
      </p>
    `,
      buttonText: 'Update Product',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static productPublished(data: { sellerName?: string; productName: string }) {
    const template = {
      title: 'Product Published',
      subtitle: 'Your product is now visible to buyers',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        Your product has been published successfully.
      </p>

      <p>
        <strong>Product:</strong> ${data.productName}
      </p>

      <p>
        Buyers can now discover your product across ODOP Mart.
      </p>
    `,
      buttonText: 'View Product',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static lowStockAlert(data: { sellerName?: string; productName: string; stock: number }) {
    const template = {
      title: 'Low Stock Alert',
      subtitle: 'Restock your product soon',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        Your product stock is running low.
      </p>

      <p>
        <strong>Product:</strong> ${data.productName}
      </p>

      <p>
        <strong>Remaining Stock:</strong> ${data.stock}
      </p>

      <p>
        Please restock to avoid missing customer orders.
      </p>
    `,
      buttonText: 'Manage Inventory',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
  static productApprovalRequest(data: {
    productName: string;
    sellerName?: string;
    storeName?: string;
  }) {
    const template = {
      title: 'New Product Approval Required',
      subtitle: 'A seller has submitted a product',
      content: `
      <p>Hello Admin,</p>
      <p>A new product has been submitted and is waiting for approval.</p>
      <p><strong>Product:</strong> ${data.productName}</p>
      ${data.sellerName ? `<p><strong>Seller:</strong> ${data.sellerName}</p>` : ''}
      ${data.storeName ? `<p><strong>Store:</strong> ${data.storeName}</p>` : ''}
      <p>Please review the product and approve or reject it.</p>
    `,
      buttonText: 'Review Product',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
  static newOrderReceived(data: {
    sellerName?: string;
    orderNo: string;
    totalAmount: number | string;
  }) {
    const template = {
      title: 'New Order Received',
      subtitle: 'You received a new order',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        Congratulations! A new order has been placed for your store.
      </p>

      <p>
        <strong>Order No:</strong> ${data.orderNo}
      </p>

      <p>
        <strong>Order Amount:</strong> ₹${data.totalAmount}
      </p>

      <p>
        Please process and ship the order as soon as possible.
      </p>
    `,
      buttonText: 'View Orders',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
  static orderShipped(data: { sellerName?: string; orderNo: string }) {
    const template = {
      title: 'Order Shipped Successfully',
      subtitle: 'Shipment update',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        Your order has been marked as shipped successfully.
      </p>

      <p>
        <strong>Order No:</strong> ${data.orderNo}
      </p>

      <p>
        The buyer has been notified.
      </p>
    `,
      buttonText: 'View Orders',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
  static orderDelivered(data: { sellerName?: string; orderNo: string }) {
    const template = {
      title: 'Order Delivered',
      subtitle: 'Order completed successfully',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        The order has been delivered successfully to the buyer.
      </p>

      <p>
        <strong>Order No:</strong> ${data.orderNo}
      </p>

      <p>
        Thank you for selling with ODOP Mart.
      </p>
    `,
      buttonText: 'View Orders',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
  static orderCancelledByBuyer(data: { sellerName?: string; orderNo: string }) {
    const template = {
      title: 'Order Cancelled By Buyer',
      subtitle: 'Order cancellation update',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        A buyer has cancelled an order.
      </p>

      <p>
        <strong>Order No:</strong> ${data.orderNo}
      </p>

      <p>
        Please stop processing or shipping this order if not dispatched.
      </p>
    `,
      buttonText: 'View Orders',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
  static returnRequestReceived(data: { sellerName?: string; orderNo: string }) {
    const template = {
      title: 'Return Request Received',
      subtitle: 'Buyer requested a return',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        A buyer has requested a return for an order item.
      </p>

      <p>
        <strong>Order No:</strong> ${data.orderNo}
      </p>

      <p>
        Please review the return request from your dashboard.
      </p>
    `,
      buttonText: 'Manage Returns',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
  static refundProcessed(data: {
    sellerName?: string;
    orderNo: string;
    refundAmount: number | string;
  }) {
    const template = {
      title: 'Refund Processed',
      subtitle: 'Refund completed successfully',
      content: `
      <p>Hello ${data.sellerName || 'Seller'},</p>

      <p>
        Refund has been processed for the order.
      </p>

      <p>
        <strong>Order No:</strong> ${data.orderNo}
      </p>

      <p>
        <strong>Refund Amount:</strong> ₹${data.refundAmount}
      </p>
    `,
      buttonText: 'View Refunds',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
}
