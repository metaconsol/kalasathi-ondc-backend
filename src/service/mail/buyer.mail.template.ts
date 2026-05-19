import { MailTemplate } from './mail.template';

export class BuyerMailTemplate extends MailTemplate {
  static buyerWelcome(name?: string) {
    const template = {
      title: `Welcome${name ? `, ${name}` : ''}!`,
      subtitle: 'Discover Authentic ODOP Products',
      content: `
        <p>Your buyer account has been created successfully.</p>

        <p>
          You can now explore authentic ODOP products,
          handmade crafts, textiles, and regional specialties.
        </p>
      `,
      buttonText: 'Start Exploring',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static otpMail(otp: string | number, name?: string) {
    return this.baseTemplate({
      title: 'Your Verification Code',
      subtitle: 'Secure Account Verification',
      content: `
        <p>Hello ${name || 'User'},</p>

        <p>Your OTP code is:</p>

        <h1
          style="
            letter-spacing:4px;
            color:#584133;
            text-align:center;
            background:#f7f1ed;
            padding:16px;
            border-radius:12px;
          "
        >
          ${otp}
        </h1>

        <p>
          This OTP is valid for a limited time.
          Please do not share it with anyone.
        </p>
      `,
    });
  }

  static forgotPassword(otp: string | number, name?: string) {
    return this.baseTemplate({
      title: 'Reset Your Password',
      subtitle: 'Forgot Password Verification',
      content: `
        <p>Hello ${name || 'User'},</p>

        <p>Use the OTP below to reset your password:</p>

        <h1
          style="
            letter-spacing:4px;
            color:#584133;
            text-align:center;
            background:#f7f1ed;
            padding:16px;
            border-radius:12px;
          "
        >
          ${otp}
        </h1>

        <p>
          If you did not request this,
          please ignore this email.
        </p>
      `,
    });
  }

  static orderPlaced(order: { customerName?: string; orderNo: string; amount: string | number }) {
    const template = {
      title: 'Order Placed Successfully',
      subtitle: 'Thank you for shopping with ODOP Mart',
      content: `
        <p>Hello ${order.customerName || 'Customer'},</p>

        <p>Your order has been placed successfully.</p>

        <p><strong>Order No:</strong> ${order.orderNo}</p>

        <p><strong>Total Amount:</strong> ₹${order.amount}</p>

        <p>
          We will notify you once your order is shipped.
        </p>
      `,
      buttonText: 'View Order',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static orderCancelled(order: { customerName?: string; orderNo: string }) {
    const template = {
      title: 'Order Cancelled',
      subtitle: 'Your order has been cancelled',
      content: `
        <p>Hello ${order.customerName || 'Customer'},</p>

        <p>Your order has been cancelled successfully.</p>

        <p><strong>Order No:</strong> ${order.orderNo}</p>
      `,
      buttonText: 'View Orders',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }

  static orderDelivered(order: { customerName?: string; orderNo: string }) {
    const template = {
      title: 'Order Delivered',
      subtitle: 'Your order has been delivered successfully',
      content: `
        <p>Hello ${order.customerName || 'Customer'},</p>

        <p>Your order has been delivered successfully.</p>

        <p><strong>Order No:</strong> ${order.orderNo}</p>

        <p>
          Thank you for supporting ODOP artisans and local sellers.
        </p>
      `,
      buttonText: 'Shop Again',
    };

    return this.baseTemplate(
      process.env.APP_URL ? { ...template, buttonUrl: process.env.APP_URL } : template,
    );
  }
}
