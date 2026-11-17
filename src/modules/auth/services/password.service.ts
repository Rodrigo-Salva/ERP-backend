import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash!: string;

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async matches(password: string, storedHash?: string): Promise<boolean> {
    // Usuarios inexistentes también ejecutan Argon2 para evitar una respuesta inmediata.
    const matches = await verify(storedHash ?? this.dummyHash, password);
    return storedHash !== undefined && matches;
  }
}
