import { hash } from "bcryptjs";
import { prisma } from "../src/lib/db";

async function main() {
  const email = process.env.DRIVE_OWNER_EMAIL;
  const name = process.env.DRIVE_OWNER_NAME;
  const password = process.env.DRIVE_OWNER_PASSWORD;

  if (!email || !name || !password) {
    throw new Error(
      "DRIVE_OWNER_EMAIL, DRIVE_OWNER_NAME, and DRIVE_OWNER_PASSWORD must be set"
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`Owner already exists: ${email} — skipping seed.`);
    return;
  }

  const hashedPassword = await hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name,
      hashedPassword,
    },
  });

  console.log(`Created owner: ${user.email} (id: ${user.id})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
