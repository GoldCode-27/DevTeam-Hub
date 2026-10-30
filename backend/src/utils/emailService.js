import nodemailer from 'nodemailer';

/**
 * Creates and configures the Nodemailer transporter.
 * Supports direct service: 'gmail' or SMTP fallback with proper timeouts.
 */
const getTransporter = () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error('Email service credentials (SMTP_USER / SMTP_PASS) are not configured');
  }

  // Gmail SMTP transporter with TLS and keepalive support
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user,
      pass
    },
    tls: {
      // Prevents connection drop on local environments
      rejectUnauthorized: false
    }
  });
};

/**
 * Dispatches an automated onboarding email containing temporary login credentials.
 * Compatible with Developer 2 auth flow and Developer 3 Admin Onboarding (T15).
 * 
 * @param {string} email - Recipient email address
 * @param {string} tempPassword - System generated temporary password
 * @returns {Promise<Object>} Nodemailer delivery result
 */
export const sendWelcomeEmail = async (email, tempPassword) => {
  if (!email || !tempPassword) {
    throw new Error('Welcome email requires a recipient address and a temporary password');
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = getTransporter();

  const mailOptions = {
    from: `"DevTeam-Hub Admin" <${from}>`,
    to: email,
    subject: 'Welcome to DevTeam-Hub! Your Temporary Account Credentials',
    text: `Hello,

An administrator has created your DevTeam-Hub account.

Temporary Password: ${tempPassword}

Please sign in at http://localhost:8080/api/auth/login and update your password immediately.

Best regards,
DevTeam-Hub Engineering Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
        <h2 style="color: #0d9488; margin-top: 0;">Welcome to DevTeam-Hub!</h2>
        <p style="color: #334155; font-size: 15px; line-height: 1.5;">An administrator has onboarded your account to the platform.</p>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #0d9488; padding: 14px 18px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0 0 8px 0; color: #475569; font-size: 14px;"><strong>Target Email:</strong> ${email}</p>
          <p style="margin: 0; color: #475569; font-size: 14px;">
            <strong>Temporary Password:</strong> 
            <code style="background-color: #e2e8f0; color: #9f1239; font-size: 16px; font-weight: bold; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.5px;">${tempPassword}</code>
          </p>
        </div>

        <p style="color: #64748b; font-size: 13px;">Please use this temporary password to log in and change your credentials immediately upon your first session.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">DevTeam-Hub Automated System Notification</p>
      </div>
    `
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`[Email Service]: Message dispatched successfully. ID: ${info.messageId}`);
  return info;
};

export default {
  sendWelcomeEmail
};