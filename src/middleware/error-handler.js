export function errorHandler(err, req, res, next) {
  console.error('Request failed:', err.code || err.name);
  const admin = req.originalUrl?.startsWith('/api/admin/');
  const status =
    err.code === 'P2002'
      ? 409
      : admin && err.code === 'P2025'
        ? 404
        : admin && ['P2003', 'P2034'].includes(err.code)
          ? 409
          : err.status || 500;
  res.status(status).json({
    message:
      err.code === 'CAMPAIGN_LOCKED'
        ? err.message
        : admin && err.code === 'P2025'
          ? 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว'
          : admin && err.code === 'P2003'
            ? 'ข้อมูลนี้มีประวัติเชื่อมโยงอยู่ ไม่สามารถลบได้'
            : admin && err.code === 'P2034'
              ? 'มีการแก้ไขพร้อมกัน กรุณาโหลดข้อมูลแล้วลองใหม่'
              : admin && err.code === 'P2002'
                ? 'ข้อมูลซ้ำ เช่น เบอร์โทร ชื่อผู้ใช้ หรือบาร์โค้ด กรุณาตรวจสอบ'
                : status === 409
                  ? 'ข้อมูลนี้มีในระบบแล้ว กรุณาเข้าสู่ระบบ'
                  : status === 503
                    ? err.message
                    : status === 400
                      ? 'รูปแบบข้อมูลไม่ถูกต้อง'
                      : 'ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่อีกครั้ง',
  });
}
