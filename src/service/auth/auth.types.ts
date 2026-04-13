import type { UserRole } from '~/generated/prisma/client';

export type UserPayloadDTO = {
  name: string;
  email: string | null;
  phoneNumber: string | null;
  username: string;
  avatar: string | null;
  role: UserRole;
  isTwoFactorEnabled: boolean;
  isRememberMe: boolean;
};

export type UserPayloadDAO = UserPayloadDTO & {
  id: number;
};
