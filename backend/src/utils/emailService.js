import nodemailer from 'nodemailer';

const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !from || !pass) {
    throw new Error('Email service is not configured');
  }

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:
      {
          user: from,
          pass: pass
        }
     
  });
};

export const sendWelcomeEmail = async (email, tempPassword) => {
  if (!email || !tempPassword) {
    throw new Error('Welcome email requires an address and temporary password');
  }

  const transporter = getTransporter();

  await transporter.sendMail({
    from,
    to: email,
    subject: 'Your DevTeam Hub account',
    text: `An administrator created your DevTeam Hub account.\n\nTemporary password: ${tempPassword}\n\nSign in and change this password as soon as you can.`,
    html: `<p>An administrator created your DevTeam Hub account.</p>
<p>Temporary password: <strong>${tempPassword}</strong></p>
<p>Sign in and change this password as soon as you can.</p>`
  });
};
