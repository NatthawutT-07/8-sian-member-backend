export const publicMember = (m) => ({
  memberNumber: `8S-${String(m.memberNumber).padStart(6, '0')}`,
  firstName: m.firstName,
  lastName: m.lastName,
  phone: m.phone,
  createdAt: m.createdAt,
});
