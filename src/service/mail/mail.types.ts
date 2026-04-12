export type MailTransport = 'smtp' | 'ses' | 'test';

export type MailAttachment = {
  filename: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  encoding?: string;
};

export type MailOptions = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  template?: string;
  context?: Record<string, any>;
  attachments?: MailAttachment[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  from?: string;
};

export type MailServiceConfig = {
  defaultTransport: MailTransport;
  defaultFrom: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    requireTLS?: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  ses?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    rateLimit?: number;
  };
  templateDir?: string;
  retryOptions?: {
    maxRetries: number;
    delayMs: number;
  };
};
