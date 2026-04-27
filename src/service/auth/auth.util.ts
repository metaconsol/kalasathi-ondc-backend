import bcrypt from 'bcrypt';

export class AuthUtil {
  private constructor() {}

  /** Match token entry by key case-insensitively; trim value (UUID must stay exact after trim). */
  public static getTokenFromBody(
    tokens: { key?: string; value?: string }[] | undefined,
    expectedKey: string,
  ): string | undefined {
    if (!Array.isArray(tokens)) {
      return undefined;
    }
    const want = expectedKey.toUpperCase();
    const entry = tokens.find((t) => String(t?.key ?? '').toUpperCase() === want);
    const raw = entry?.value;
    if (raw == null) {
      return undefined;
    }
    return String(raw).trim();
  }

  public static getHashedPassword = async (password: string): Promise<string> => {
    return await bcrypt.hash(password, 10);
  };

  public static compareHashedPassword = async (
    password: string,
    hashedPassword: string,
  ): Promise<boolean> => {
    return await bcrypt.compare(password, hashedPassword);
  };

  public static convert<S extends Record<string, any>, T extends Record<string, any>>(
    source: S & Partial<T>,
  ): T {
    const result: Partial<T> = {};
    const targetKeys = Object.keys({} as T) as (keyof T)[];
    for (const key of targetKeys) {
      if (key in source) {
        result[key] = source[key] as T[keyof T];
      }
    }
    return result as T;
  }

  public static convertToType<S, T>(source: S & Partial<T>, schema: { [K in keyof T]: true }): T {
    const result = {} as T;
    const targetKeys = Object.keys(schema) as (keyof T)[];

    for (const key of targetKeys) {
      if (key in source) {
        result[key] = source[key] as T[keyof T];
      }
    }
    return result;
  }

  public static getParentDomain(url: string): string | undefined {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      const parts = hostname.split('.');

      if (parts.length < 2) {
        return undefined;
      }

      // For most cases, take the last two or three parts depending on the TLD
      // e.g., rishi.publicvm.com -> rishi.publicvm.com
      // e.g., th-be.rishi.publicvm.com -> rishi.publicvm.com
      // Handle common TLDs like co.uk, com.au, etc.
      const tldRegex = /^(co|com|org|net|gov|edu)\.[a-z]{2}$/i;
      const isComplexTLD =
        parts.length >= 3 && tldRegex.test(`${parts[parts.length - 2]}.${parts[parts.length - 1]}`);

      if (isComplexTLD) {
        // For complex TLDs (e.g., example.co.uk), return last three parts
        return parts.slice(-3).join('.');
      } else {
        // For standard TLDs (e.g., example.com), return last two or more parts
        return parts.slice(-2 - (parts.length > 2 ? 1 : 0)).join('.');
      }
    } catch (error) {
      console.error('Invalid URL:', error);
      return undefined;
    }
  }
}
