import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// BigInt не сериализуется в JSON по умолчанию (Media.sizeBytes, Event.id, telegramId)
// @ts-expect-error - патчим прототип ради JSON.stringify
BigInt.prototype.toJSON = function () {
  return this.toString();
};
