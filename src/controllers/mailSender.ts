/* eslint-disable @typescript-eslint/ban-ts-comment */
import nodemailer from 'nodemailer';
import { google } from 'googleapis';

export default class MailSender {
  public static async sendEmail(email: {
    sendTo: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const createTransporter = async () => {
      const { OAuth2 } = google.auth;
      const oauth2Client = new OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_SECRET_KEY,
        'https://developers.google.com/oauthplayground',
      );

      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      });

      const accessToken = await new Promise((resolve, reject) => {
        oauth2Client.getAccessToken((err, token) => {
          if (err) {
            reject(
              new Error(
                `Google - Failed to create access token: ${err.code}-${err.message}\nClient-ID: ${process.env.GOOGLE_CLIENT_ID}\nSecret-Key: ${process.env.GOOGLE_SECRET_KEY}\nRefresh-Token: ${process.env.GOOGLE_REFRESH_TOKEN}`,
              ),
            );
          }
          resolve(token);
        });
      });

      const transporter = nodemailer.createTransport({
        // @ts-ignore
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          type: 'OAuth2',
          user: process.env.GOOGLE_EMAIL,
          accessToken,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_SECRET_KEY,
          refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
        },
      });

      return transporter;
    };

    const sendEmail = async (emailOptions: any) => {
      const emailTransporter = await createTransporter();
      await emailTransporter.sendMail(emailOptions);
    };

    await sendEmail({
      from: `"${process.env.GOOGLE_EMAIL_SENDERNAME}" ${process.env.GOOGLE_EMAIL}`,
      to: email.sendTo,
      subject: email.subject,
      html: email.html,
    });
  }
}
