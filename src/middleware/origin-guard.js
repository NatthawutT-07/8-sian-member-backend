export function originGuard(origin) {
  return (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) {
      return res.status(403).json({ message: 'แหล่งที่มาของคำขอไม่ได้รับอนุญาต' });
    }
    next();
  };
}
