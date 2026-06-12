import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const media = await prisma.media.findFirst({ select: { id: true } });
  console.log("MEDIA_ID=" + (media?.id || "NONE"));
  const user = await prisma.user.findFirst({ where: { role: 'admin' }, select: { email: true } });
  console.log("ADMIN_EMAIL=" + (user?.email || "NONE"));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
