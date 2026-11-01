export async function withCashierNames(db, sales) {
  if (!sales.length) return [];
  const users = await db.posUser.findMany({
    where: { id: { in: [...new Set(sales.map((sale) => sale.actor))] } },
    select: { id: true, displayName: true },
  });
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  const memberIds = [...new Set(sales.map((sale) => sale.memberId).filter(Boolean))];
  const members = memberIds.length
    ? await db.member.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, phone: true },
      })
    : [];
  const phones = new Map(members.map((member) => [member.id, member.phone]));
  return sales.map((sale) => ({
    ...sale,
    cashierDisplayName: names.get(sale.actor) || null,
    memberPhone: phones.get(sale.memberId) || null,
  }));
}
