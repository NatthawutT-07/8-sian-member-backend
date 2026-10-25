export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production && !env.FRONTEND_ORIGIN) throw new Error('Set FRONTEND_ORIGIN');
  return {
    production,
    origin: env.FRONTEND_ORIGIN || 'http://localhost:5173',
    port: env.PORT || 3001,
    trustProxy: production ? 1 : false,
    cookieName: production ? '__Host-member_session' : 'member_session',
    cookieOptions: {
      httpOnly: true,
      secure: production,
      sameSite: production ? 'none' : 'lax',
      path: '/',
    },
  };
}
