const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
    const media = await prisma.media.findFirst({ select: { id: true, fileId: true } });
    console.log("REAL_MEDIA_ID=" + (media ? media.id : "NONE"));
    console.log(media);
    process.exit(0);
}
main().catch(console.error);
