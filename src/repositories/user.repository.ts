import { Prisma, type RoleName, type UserStatus } from '@prisma/client';
import { prisma, type DbClient } from '../config/prisma';

export const userWithRole = Prisma.validator<Prisma.UserDefaultArgs>()({ include: { role: true } });
export type UserWithRole = Prisma.UserGetPayload<typeof userWithRole>;

export interface UserListFilter {
  search?: string;
  role?: RoleName;
  status?: UserStatus;
  skip: number;
  take: number;
}

function buildWhere(filter: Omit<UserListFilter, 'skip' | 'take'>): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = filter.status ? { status: filter.status } : { status: { not: 'DELETED' } };
  if (filter.role) where.role = { name: filter.role };
  if (filter.search) {
    where.OR = [
      { email: { contains: filter.search } },
      { firstName: { contains: filter.search } },
      { lastName: { contains: filter.search } },
    ];
  }
  return where;
}

export const userRepository = {
  findById(id: string, db: DbClient = prisma) {
    return db.user.findUnique({ where: { id }, ...userWithRole });
  },

  findByEmail(email: string, db: DbClient = prisma) {
    return db.user.findUnique({ where: { email: email.toLowerCase() }, ...userWithRole });
  },

  async list(filter: UserListFilter) {
    const where = buildWhere(filter);
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        ...userWithRole,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      prisma.user.count({ where }),
    ]);
    return { items, total };
  },

  create(data: Prisma.UserUncheckedCreateInput, db: DbClient = prisma) {
    return db.user.create({ data, ...userWithRole });
  },

  update(id: string, data: Prisma.UserUncheckedUpdateInput, db: DbClient = prisma) {
    return db.user.update({ where: { id }, data, ...userWithRole });
  },
};
