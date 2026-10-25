export function errorHandler(err, req, res, next) {
  console.error('Request failed:', err.code || err.name);
  const status = err.code === 'P2002' ? 409 : err.status || 500;
  res.status(status).json({
    message:
      err.code === 'CAMPAIGN_LOCKED'
        ? err.message
        : status === 409
          ? 'ข้อมูลนี้มีในระบบแล้ว กรุณาเข้าสู่ระบบ'
          : status === 503
            ? err.message
            : status === 400
              ? 'รูปแบบข้อมูลไม่ถูกต้อง'
              : 'ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่อีกครั้ง',
  });
}
