/** Logged-in: `userId` from Bearer. Guest: `sessionId` from `X-Cart-Session` (Bearer wins when both sent). */
export type CartOwner =
  | { userId: number; sessionId?: undefined }
  | { sessionId: string; userId?: undefined };
