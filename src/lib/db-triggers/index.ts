// import { Prisma } from "~/generated/prisma/client.js";

export const trigger = async (params: any, next: (params: any) => Promise<any>) => {
  if (params.action == 'create') {
    const result = await next(params);

    return result;
  }

  if (params.action == 'update') {
    const result = await next(params);

    return result;
  }

  if (params.action == 'delete') {
    const result = await next(params);

    return result;
  }

  return next(params);
};
