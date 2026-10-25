import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/shared/security.js';
if (!process.stdin.isTTY) {
  console.error('Use an interactive terminal.');
  process.exit(1);
}
const db = new PrismaClient();
let hidden = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!hidden) process.stdout.write(chunk, encoding);
    callback();
  },
});
const terminal = createInterface({ input: process.stdin, output, terminal: true });
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
  if (await db.admin.count()) throw new Error('The single admin already exists. No changes made.');
  const username =
    (await terminal.question('Admin username (3-80 characters, blank = admin): ')).trim() ||
    'admin';
  if (username.length < 3 || username.length > 80) throw new Error('Invalid username.');
  const password = await secret('Admin password (12-128 characters, hidden): ');
  if (password.length < 12 || password.length > 128)
    throw new Error('Admin password must contain 12-128 characters.');
  if (password !== (await secret('Confirm admin password (hidden): ')))
    throw new Error('Passwords do not match.');
  await db.$transaction(async (tx) => {
    await tx.admin.create({
      data: { id: 'owner', username, passwordHash: await hashPassword(password), role: 'ADMIN' },
    });
    await tx.auditLog.create({
      data: { actor: 'owner', action: 'CREATE_ADMIN', details: { source: 'local-setup' } },
    });
  });
  console.log(
    'Single admin created. Sign in at /control-8sian-4d9c7a2e7f (or VITE_ADMIN_PATH if configured).',
  );
} catch (e) {
  console.error(e.code === 'P2002' ? 'The single admin already exists.' : e.message);
  process.exitCode = 1;
} finally {
  terminal.close();
  await db.$disconnect();
}
