import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const users = await db.user.findMany();
console.log("USERS:", users);
await db.$disconnect();
