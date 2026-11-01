export function receiptTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    businessDate: `${value.year}-${value.month}-${value.day}`,
    prefix: `${value.year.slice(-2)}${value.month}${value.day}${value.hour}${value.minute}`,
  };
}
export async function nextReceiptNumber(tx, now) {
  const { businessDate, prefix } = receiptTime(now);
  const counter = await tx.posReceiptCounter.upsert({
    where: { businessDate },
    create: { businessDate, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `${prefix}${String(counter.lastNumber).padStart(3, '0')}`;
}
