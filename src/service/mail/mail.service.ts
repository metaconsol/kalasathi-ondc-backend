import nodemailer from 'nodemailer';
import type { MailOptions, MailServiceConfig, MailTransport } from './mail.types';
import { env } from '~/config/env.config';
import { meta } from '~/lib/meta';

export class MailService {
  private transporter: nodemailer.Transporter;
  private config: MailServiceConfig;

  constructor(
    config: MailServiceConfig = {
      defaultTransport: 'smtp', // or 'ses' for AWS SES
      defaultFrom: `${meta.appName} <${env.mailUser}>`,
      smtp: {
        host: env.mailHost!,
        port: env.mailPort!,
        secure: env.mailPortSecure, // true for 465, false for other ports
        auth: {
          user: env.mailUser!,
          pass: env.mailPassword!,
        },
      },
      retryOptions: {
        maxRetries: 3,
        delayMs: 1000,
      },
    },
  ) {
    this.config = config;
    this.transporter = this.createTransporter(config.defaultTransport) as nodemailer.Transporter;
  }

  private createTransporter(transportType: MailTransport): nodemailer.Transporter | undefined {
    switch (transportType) {
      case 'smtp':
        if (!this.config.smtp) {
          throw new Error('SMTP configuration is required for SMTP transport');
        }
        return nodemailer.createTransport(this.config.smtp);

      case 'ses':
        if (!this.config.ses) {
          throw new Error('SES configuration is required for SES transport');
        }
        // const ses = new AWS.SES({
        //   region: this.config.ses.region,
        //   accessKeyId: this.config.ses.accessKeyId,
        //   secretAccessKey: this.config.ses.secretAccessKey,
        // });
        // return nodemailer.createTransport(
        //   sesTransport({
        //     SES: { ses, aws: AWS },
        //     sendingRate: this.config.ses.rateLimit || 1,
        //   }),
        // );
        break;

      case 'test':
        return nodemailer.createTransport({
          streamTransport: true,
          newline: 'unix',
          buffer: true,
        });
        break;

      default:
        throw new Error(`Unsupported transport type: ${transportType}`);
    }
  }

  public async switchTransport(transportType: MailTransport): Promise<void> {
    this.transporter.close();
    this.transporter = this.createTransporter(transportType);
  }

  public async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      return false;
    }
  }

  private async prepareMailOptions(options: MailOptions): Promise<nodemailer.SendMailOptions> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: options.from || this.config.defaultFrom,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      cc: options.cc,
      bcc: options.bcc,
      replyTo: options.replyTo,
      attachments: options.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        path: attachment.path,
        contentType: attachment.contentType,
        encoding: attachment.encoding,
      })),
    };

    // Handle template if provided
    // if (options.template) {
    //   if (!options.context) {
    //     options.context = {};
    //   }
    //   mailOptions.html = await this.compileTemplate(options.template, options.context);
    //   // If no text version provided, generate one from HTML
    //   if (!mailOptions.text && mailOptions.html) {
    //     mailOptions.text = mailOptions.html.replace(/<[^>]*>/g, "");
    //   }
    // }

    return mailOptions;
  }

  private async sendWithRetry(
    mailOptions: nodemailer.SendMailOptions,
    attempt = 1,
  ): Promise<nodemailer.SentMessageInfo> {
    try {
      return await this.transporter.sendMail(mailOptions);
    } catch (error) {
      const maxRetries = this.config.retryOptions?.maxRetries || 3;
      const delayMs = this.config.retryOptions?.delayMs || 1000;

      if (attempt >= maxRetries) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      return this.sendWithRetry(mailOptions, attempt + 1);
    }
  }

  public async sendMail(options: MailOptions) {
    try {
      if (!(await this.verifyConnection())) {
        throw new Error('Connection to mail server failed');
      }
      const mailOptions = await this.prepareMailOptions(options);
      return this.sendWithRetry(mailOptions);
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  public sendMailAndClose = async (options: MailOptions) => {
    try {
      await this.sendMail(options);
      await this.close();
    } catch (error) {
      return null;
    }
  };

  public close = async (): Promise<void> => {
    await this.transporter.close();
  };
}

export async function mailServiceQucik(options: MailOptions, config?: MailServiceConfig) {
  try {
    const mailService = new MailService(config);
    await mailService.sendMailAndClose(options);
  } catch (error) {
    console.log(error);
  }
}
