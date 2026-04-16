export class OTPTemplate {
  public static verificationForSMS = (code: string) => {
    return `Dear Customer, your OTP for Mrignayanee Registration is {#var#}. Valid for 5 minutes. Please do not share it with anyone. -Mrignayanee`;
  };
  public static forgotPasswordForSMS = (code: string) => {
    return `Your forgot password code is ${code}. Please use this code to reset your password.`;
  };
  public static verificationForEmail = (otp: string, userName: string): string => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f5f5f5;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 600px;
            margin: 20px auto;
            background: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          }
          .header {
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            color: white;
            padding: 30px 20px;
            text-align: center;
          }
          .logo {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 10px;
          }
          .content {
            padding: 30px;
          }
          .otp-container {
            margin: 25px 0;
            text-align: center;
          }
          .otp-box {
            display: inline-block;
            background: #f8f9fa;
            border-radius: 6px;
            padding: 15px 25px;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: 3px;
            color: #1a1a1a;
            border: 1px dashed #4f46e5;
            cursor: pointer;
          }
          .copy-hint {
            font-size: 14px;
            color: #666;
            margin-top: 8px;
          }
          .instructions {
            background: #f0f9ff;
            border-left: 4px solid #3b82f6;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 4px 4px 0;
          }
          .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 12px;
            border-top: 1px solid #eee;
          }
          .highlight {
            font-weight: 600;
            color: #4f46e5;
          }
          .cta-text {
            margin-top: 25px;
            font-size: 15px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">Tech Horizon AI</div>
            <h2>Your Verification Code</h2>
          </div>
          <div class="content">
            <p>Hello <span class="highlight">${userName}</span>,</p>
            <p>We received a request to verify your account. Here's your One-Time Password (OTP):</p>
            
            <div class="otp-container">
              <!-- OTP Box with selectable text -->
              <div class="otp-box" onclick="this.select(); document.execCommand('copy');">
                ${otp}
              </div>
            </div>
            
            <div class="instructions">
              <p>⏳ This code expires in <span class="highlight">10 minutes</span></p>
              <p>🔒 For security, never share this code with anyone</p>
            </div>
            
            <p class="cta-text">If you didn't request this, please ignore this email or contact our support team immediately.</p>
            
            <p>Best regards,<br>The Tech Horizon AI Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Tech Horizon AI. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  };
  public static forgotPasswordForEmail = (otp: string, userName: string): string => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body {
            font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f5f5f5;
            margin: 0;
            padding: 0;
          }
        </style>
        <style>
          .container {
            max-width: 600px;
            margin: 20px auto;
            background: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          }
        </style>
        <style>
          .header {
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            color: white;
            padding: 30px 20px;
            text-align: center;
          }
        </style>
        <style>
          .logo {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 10px;
          }
        </style>
        <style>
          .content {
            padding: 30px;
          }
        </style>
        <style>
          .otp-container {
            margin: 25px 0;
            text-align: center;
          }
        </style>
        <style>
          .otp-box {
            display: inline-block;
            background: #f8f9fa;
            border-radius: 6px;
            padding: 15px 25px;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: 3px;
            color: #1a1a1a;
            border: 1px dashed #4f46e5;
            cursor: pointer;
          }
        </style>
        <style>
          .copy-hint {
            font-size: 14px;
            color: #666;
            margin-top: 8px;
          }
        </style>
        <style>
          .instructions {
            background: #f0f9ff;
            border-left: 4px solid #3b82f6;
            padding: 15px;
            margin: 20px 0;
            border-radius: 0 4px 4px 0;
          }
        </style>
        <style>
          .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 12px;
            border-top: 1px solid #eee;
          }
        </style>
        <style>
          .highlight {
            font-weight: 600;
            color: #4f46e5;
          }
        </style>
        <style>
          .cta-text {
            margin-top: 25px;
            font-size: 15px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">Tech Horizon AI</div>
            <h2>Your Forgot Password Code</h2>
          </div>
          <div class="content">
            <p>Hello <span class="highlight">${userName}</span>,</p>
            <p>We received a request to reset your password. Here's your One-Time Password (OTP):</p>
            <div class="otp-container">
              <div class="otp-box" onclick="this.select(); document.execCommand('copy');">
                ${otp}
              </div>
            </div>
            <div class="instructions">
              <p>⏳ This code expires in <span class="highlight">10 minutes</span></p>
              <p>🔒 For security, never share this code with anyone</p>
            </div>
            <p class="cta-text">If you didn't request this, please ignore this email or contact our support team immediately.</p>
            <p>Best regards,<br>The Tech Horizon AI Team</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Tech Horizon AI. All rights reserved.</p>
          </div>
        </div>
      </body>
    `;
  };
}
