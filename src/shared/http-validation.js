export function parseBody(schema, body, res) {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบช่องที่กรอก' });
    return null;
  }
  return result.data;
}
