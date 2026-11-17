import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import nodemailer from 'nodemailer';
import { Environment } from '../../../config/environment';
@Injectable()
export class MailService {
  constructor(private readonly config: ConfigService<Environment, true>) {}
  async send(
    to: string,
    subject: string,
    path: string,
    token: string,
  ): Promise<void> {
    const link = new URL(path, this.config.get('APP_URL', { infer: true }));
    link.hash = `token=${token}`;
    const text = `${subject}\n\n${link.toString()}\n\nSi no solicitaste este mensaje, puedes ignorarlo.`;
    if (this.config.get('MAIL_TRANSPORT', { infer: true }) === 'local') {
      if (this.config.get('NODE_ENV', { infer: true }) === 'production')
        throw new Error('Configura correo SMTP en producción');
      const directory = resolve(__dirname, '../../../../.local-mail');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        resolve(directory, `${randomUUID()}.eml`),
        `To: ${to}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${text}`,
        { mode: 0o600, flag: 'wx' },
      );
      return;
    }
    const host = this.config.get('SMTP_HOST', { infer: true });
    if (!host) throw new Error('SMTP_HOST requerido');
    const port = this.config.get('SMTP_PORT', { infer: true });
    const user = this.config.get('SMTP_USER', { infer: true });
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: true,
      auth: user
        ? { user, pass: this.config.get('SMTP_PASSWORD', { infer: true }) }
        : undefined,
      connectionTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await transport.sendMail({
      from: this.config.get('MAIL_FROM', { infer: true }),
      to,
      subject,
      text,
    });
  }
}
