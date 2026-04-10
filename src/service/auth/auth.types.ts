import type { Response } from 'express';

export interface AuthResponseDTO extends Response {
  error?: string;
  message?: string;
  is2FA?: boolean;
  redirectTo?: string;
  user?: UserPayloadDTO;
  errors?: {
    name?: string[];
    email?: string[];
    password?: string[];
  };
}

export type UserPayloadDTO = {
  name: string;
  email: string;
  username: string;
  avatar: string | null;
  role: string;
  isTwoFactorEnabled: boolean;
  isCredentialAccount: boolean;
};

export type UserPayloadDAO = UserPayloadDTO & {
  id: string;
};

export type AccountType = 'credentials' | 'google' | 'github';

export type GoogleUserInfo = {
  sub: string; // Google's unique user ID
  email: string;
  name?: string;
  given_name?: string;
  picture?: string;
};

export type GithubUserInfo = {
  id: number;
  login: string;
  email?: string;
  name?: string;
  avatar_url?: string;
};

export type OAuthTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
};

export type OAuthUserInfo = {
  accountId: string;
  avatar?: string;
  email: string;
  name: string;
};

export type OAuthResponse = {
  user: OAuthUserInfo;
  token: OAuthTokenResponse;
};

export type UserPayloadOTP = {
  name: string;
  email: string;
};
