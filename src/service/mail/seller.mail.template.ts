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
}
