import { createHash, randomBytes } from 'node:crypto';
import { hash, verify, argon2id } from 'argon2';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { Database } from 'better-sqlite3';
import type { DataSource } from 'typeorm';
import { SetupAccountRequestSchema, LoginRequestSchema, ChangePasswordRequestSchema, type AuthSession } from '@pr-orchestrator/contracts';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
interface User { username: string; password_hash: string; }
export class AuthService {
  private readonly db: Database;
  constructor(source: DataSource, private readonly clock = () => new Date()) { this.db = (source.driver as unknown as { databaseConnection: Database }).databaseConnection; }
  async setup(input: unknown) {
    const data = SetupAccountRequestSchema.parse(input);
    if (this.db.prepare('SELECT 1 FROM user_accounts').get()) throw new ConflictException('Account already configured');
    const password = await hash(data.password, { type: argon2id }); const now = this.clock().toISOString();
    try { this.db.prepare('INSERT INTO user_accounts (id,username,password_hash,created_at,updated_at) VALUES (1,?,?,?,?)').run(data.username, password, now, now); }
    catch { throw new ConflictException('Account already configured'); }
    return this.issue(data.username);
  }
  async login(input: unknown) {
    const data = LoginRequestSchema.parse(input); const user = this.db.prepare('SELECT username,password_hash FROM user_accounts WHERE id=1').get() as User | undefined;
    if (!user || user.username !== data.username || !await verify(user.password_hash, data.password)) throw new UnauthorizedException('Invalid username or password');
    // A password change may have raced with the asynchronous hash verification.
    const current = this.db.prepare('SELECT password_hash FROM user_accounts WHERE id=1').get() as User;
    if (current.password_hash !== user.password_hash) throw new UnauthorizedException('Password changed; sign in again');
    return this.issue(user.username);
  }
  private issue(username: string) {
    const token = randomBytes(32).toString('base64url'); const expiresAt = new Date(this.clock().getTime() + 43200000).toISOString();
    this.db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,1,?)').run(digest(token), expiresAt);
    return { token, session: { authenticated: true, setupRequired: false, username, expiresAt } as AuthSession };
  }
  async getSession(token?: string): Promise<AuthSession> {
    if (token) {
      const row = this.db.prepare('SELECT s.expires_at,u.username FROM sessions s JOIN user_accounts u ON u.id=s.user_id WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(digest(token), this.clock().toISOString()) as { expires_at: string; username: string } | undefined;
      if (row) return { authenticated: true, setupRequired: false, username: row.username, expiresAt: row.expires_at };
    }
    return { authenticated: false, setupRequired: !this.db.prepare('SELECT 1 FROM user_accounts').get() };
  }
  async logout(token?: string) { if (token) this.db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(this.clock().toISOString(), digest(token)); }
  async changePassword(token: string, input: unknown) {
    const data = ChangePasswordRequestSchema.parse(input);
    if (!(await this.getSession(token)).authenticated) throw new UnauthorizedException();
    const user = this.db.prepare('SELECT password_hash FROM user_accounts WHERE id=1').get() as User;
    if (!await verify(user.password_hash, data.currentPassword)) throw new UnauthorizedException('Invalid current password');
    const replacement = await hash(data.newPassword, { type: argon2id });
    this.db.transaction(() => {
      const session = this.db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(digest(token), this.clock().toISOString());
      if (!session) throw new UnauthorizedException();
      if (!this.db.prepare('UPDATE user_accounts SET password_hash=?,updated_at=? WHERE id=1 AND password_hash=?').run(replacement, this.clock().toISOString(), user.password_hash).changes) throw new UnauthorizedException('Password changed; retry');
      this.db.prepare('UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL').run(this.clock().toISOString());
    }).immediate();
  }
}
