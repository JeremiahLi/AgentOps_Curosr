import { PrismaClient } from "@prisma/client";

/**
 * Prisma 单例。
 *
 * 之前 37 处各自 `new PrismaClient()`：dev 模式下每次 HMR 重新求值模块都会新建
 * 一个实例，各自的查询引擎与 SQLite 文件句柄不会被回收，长期开发会累积成
 * 句柄/内存泄漏，并在并发写入（上传）时更容易撞到 database is locked。
 * 用 globalThis 缓存跨热更新复用同一实例；生产环境冷启动只建一次。
 */
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = prisma;
