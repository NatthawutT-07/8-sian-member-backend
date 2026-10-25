// Local administrator utility; never exposed through the public API.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/shared/security.js';
import { phone as phoneSchema } from '../src/modules/auth/auth.validation.js';

if (!process.stdin.isTTY) {
  console.error('Run this command in an interactive terminal.');
  process.exit(1);
}
let hidden = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!hidden) process.stdout.write(chunk, encoding);
    callback();
  },
});
const terminal = createInterface({ input: process.stdin, output, terminal: true });
const db = new PrismaClient();
async function secret(prompt) {
  process.stdout.write(prompt);
  hidden = true;
  try {
    return await terminal.question('');
  } finally {
    hidden = false;
    process.stdout.write('\n');
  }
}
try {
  const phone = (await terminal.question('Member phone (10 digits): ')).trim();
  if (!phoneSchema.safeParse(phone).success) throw new Error('Invalid Thai mobile number.');
  const member = await db.member.findUnique({ where: { phone }, select: { id: true } });
  if (!member) throw new Error('Member not found. Register an account first.');
  const reason = (
    await terminal.question('Reason / identity check (5-300 characters, no passwords): ')
  ).trim();
  if (reason.length < 5 || reason.length > 300)
    throw new Error('A reason with 5-300 characters is required.');
  const password = await secret('New password (at least 8 characters, hidden): ');
  if (password.length < 8 || password.length > 128)
    throw new Error('Password must contain 8 to 128 characters.');
  const confirmation = await secret('Confirm password (hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match. Nothing changed.');
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.member.update({ where: { id: member.id }, data: { passwordHash } }),
    db.session.deleteMany({ where: { memberId: member.id } }),
    db.auditLog.create({
      data: {
        actor: 'local-maintenance',
        action: 'RESET_MEMBER_PASSWORD',
        memberId: member.id,
        details: { reason, source: 'local-terminal' },
      },
    }),
  ]);
  console.log('Password updated. Existing sessions revoked. Sign in with the new password.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  terminal.close();
  await db.$disconnect();
}
