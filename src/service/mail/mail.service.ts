import nodemailer from 'nodemailer';

// import { meta } from '~/lib/meta';
import { logger } from '~/lib/logger';
import { AppError } from '~/lib/response';
import { env } from '~/config/env.config';
import { errorCodes } from '~/middleware/error.middleware';
import type { MailOptions, MailServiceConfig, MailTransport } from './mail.types';
import { debugForDev } from '~/lib/utils';

export class MailService {
  private transporter: nodemailer.Transporter;
  private config: MailServiceConfig;

  private readonly defaultMailServiceConfig: MailServiceConfig = {
    defaultTransport: env.mailService as MailTransport, // or 'ses' for AWS SES
    // defaultFrom: `${meta.appName} <${env.mailUser}>`,
    defaultFrom: env.mailFrom ? `${env.mailFrom} <${env.mailUser}>` : env.mailUser,
    smtp: {
      host: env.mailHost!,
      port: env.mailPort!,
      secure: env.mailPortSecure, // true for 465, false for other ports
      requireTLS: !env.mailPortSecure && env.mailPort === 587,
      auth: {
        user: env.mailUser!,
        pass: env.mailPassword!,
      },
    },
    retryOptions: {
      maxRetries: 3,
      delayMs: 1000,
    },
  };

  constructor(
    config: MailServiceConfig = {
      ...this.defaultMailServiceConfig,
    },
  ) {
    this.config = config;
    this.transporter = this.createTransporter(this.config.defaultTransport);
  }

  private createTransporter(transportType: MailTransport): nodemailer.Transporter {
    switch (transportType) {
      case 'smtp':
        if (!this.config.smtp) {
          throw new AppError(
            'SMTP configuration is required for SMTP transport',
            500,
            true,
            errorCodes.MAIL_CONNECTION_FAILURE,
          );
        }
        // return nodemailer.createTransport(this.config.smtp);
        return nodemailer.createTransport({
          ...this.config.smtp,
          tls: {
            rejectUnauthorized: false,
          },
        });

      case 'ses':
        if (!this.config.ses) {
          throw new AppError(
            'SES configuration is required for SES transport',
            500,
            true,
            errorCodes.MAIL_CONNECTION_FAILURE,
          );
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
        throw new AppError(
          `Unsupported transport type: ${transportType}`,
          500,
          true,
          errorCodes.MAIL_CONNECTION_FAILURE,
        );

      case 'test':
        return nodemailer.createTransport({
          streamTransport: true,
          newline: 'unix',
          buffer: true,
        });

      default:
        throw new AppError(
          `Unsupported transport type: ${transportType}`,
          500,
          true,
          errorCodes.MAIL_CONNECTION_FAILURE,
        );
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
      //debug
      debugForDev('RAW NODEMAILER ERROR', error);

      const message = error instanceof Error ? error.message : String(error);

      logger.error(`MAIL ERROR: ${message}`);
      const maxRetries = this.config.retryOptions?.maxRetries || 3;
      const delayMs = this.config.retryOptions?.delayMs || 1000;

      if (attempt >= maxRetries) {
        throw new AppError(
          `Error sending mail: ${message}`,
          500,
          true,
          errorCodes.MAIL_SEND_FAILURE,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      return this.sendWithRetry(mailOptions, attempt + 1);
    }
  }

  public async sendMail(options: MailOptions) {
    try {
      const mailOptions = await this.prepareMailOptions(options);
      return this.sendWithRetry(mailOptions);
    } catch (error) {
      throw new AppError('Error sending mail', 500, true, errorCodes.MAIL_SEND_FAILURE);
    }
  }

  public sendMailAndClose = async (options: MailOptions) => {
    try {
      await this.sendMail(options);
      await this.close();
    } catch (error) {
      debugForDev('Error sending mail', error);
      throw new AppError('Error sending mail', 500, true, errorCodes.MAIL_SEND_FAILURE);
    }
  };

  public close = async (): Promise<void> => {
    await this.transporter.close();
  };
}

export async function mailServiceQucik(options: MailOptions, config?: MailServiceConfig) {
  try {
    const mailService = new MailService(config || undefined);
    await mailService.sendMailAndClose(options);
  } catch (error) {
    throw new AppError('Error sending mail', 500, true, errorCodes.MAIL_SEND_FAILURE);
  }
}

export async function mailServiceAsync(options: MailOptions, config?: MailServiceConfig) {
  try {
    debugForDev('Mail Request', { to: options?.to, subject: options?.subject });
    const mailService = new MailService(config || undefined);
    await mailService.sendMailAndClose(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // OTP/SMS flow does not depend on mail; log at warn so it is not mistaken for verify/OTP failure.
    logger.warn(`OTP mail send failed (non-blocking): ${message} to=${options.to}`);
  }
}
