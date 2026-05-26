export class MailTemplate {
  protected static baseTemplate({
    title,
    subtitle,
    content,
    buttonText,
    buttonUrl,
  }: {
    title: string;
    subtitle?: string;
    content: string;
    buttonText?: string;
    buttonUrl?: string;
  }) {
    return `
      <div style="margin:0;padding:0;background:#584133;font-family:Arial,sans-serif;">
        <div style="max-width:620px;margin:0 auto;padding:24px;">

          <div style="background:#584133;color:#fff;padding:32px 24px;text-align:center;border-radius:18px 18px 0 0;">

            <img
              src="${process.env.SERVER_URL}/uploads/odop-logo.png"
              alt="ODOP Mart"
              style="
                max-width:180px;
                width:100%;
                height:auto;
                object-fit:contain;
                display:block;
                margin:0 auto;
              "
            />

            ${subtitle ? `<p style="margin:10px 0 0;font-size:15px;">${subtitle}</p>` : ''}

          </div>

          <div style="background:#fff;padding:32px 24px;border-radius:0 0 18px 18px;">

            <h2 style="margin:0 0 16px;color:#584133;font-size:24px;">
              ${title}
            </h2>

            <div style="font-size:15px;line-height:1.8;color:#444;">
              ${content}
            </div>

            ${
              buttonText && buttonUrl
                ? `
                <div style="text-align:center;margin-top:28px;">
                  <a
                    href="${buttonUrl}"
                    style="
                      display:inline-block;
                      background:#584133;
                      color:#fff;
                      text-decoration:none;
                      padding:13px 28px;
                      border-radius:999px;
                      font-weight:600;
                    "
                  >
                    ${buttonText}
                  </a>
                </div>
              `
                : ''
            }

            <p style="margin-top:32px;font-size:15px;color:#444;">
              Regards,<br />
              <strong>ODOP Mart Team</strong>
            </p>

          </div>

          <p style="text-align:center;font-size:12px;color:#777;margin-top:16px;">
            © ${new Date().getFullYear()} ODOP Mart. All rights reserved.
          </p>

        </div>
      </div>
    `;
  }
}
