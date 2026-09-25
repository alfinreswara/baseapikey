import { loadAuthConfig } from './auth.config';
import { JwtService } from './services/jwt.service';
import { PasswordService, passwordService } from './services/password.service';
import type { AuthConfig } from './types/auth.types';

export class AuthModule {
  private static instance: AuthModule;
  public readonly config: AuthConfig;
  public readonly jwtService: JwtService;
  public readonly passwordService: PasswordService;

  constructor(customConfig?: AuthConfig) {
    this.config = customConfig ?? loadAuthConfig();
    this.jwtService = new JwtService(this.config);
    this.passwordService = passwordService;
  }

  public static getInstance(customConfig?: AuthConfig): AuthModule {
    if (!AuthModule.instance) {
      AuthModule.instance = new AuthModule(customConfig);
    }
    return AuthModule.instance;
  }
}
