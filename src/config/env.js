export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production && !env.FRONTEND_ORIGIN) throw new Error('Set FRONTEND_ORIGIN');
  const lineValues = [
    env.LINE_LOGIN_CHANNEL_ID,
    env.LINE_LOGIN_CHANNEL_SECRET,
    env.LINE_LOGIN_CALLBACK_URL,
  ];
  if (lineValues.some(Boolean) && !lineValues.every(Boolean))
    throw new Error(
      'Set all LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET, LINE_LOGIN_CALLBACK_URL',
    );
  if (lineValues.every(Boolean)) {
    const callback = new URL(env.LINE_LOGIN_CALLBACK_URL);
    if (
      callback.pathname !== '/api/auth/line/callback' ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password ||
      (production && callback.protocol !== 'https:') ||
      !['https:', 'http:'].includes(callback.protocol)
    )
      throw new Error('Invalid LINE_LOGIN_CALLBACK_URL');
  }
  return {
    line: lineValues.every(Boolean)
      ? {
          channelId: env.LINE_LOGIN_CHANNEL_ID,
          channelSecret: env.LINE_LOGIN_CHANNEL_SECRET,
          callbackUrl: env.LINE_LOGIN_CALLBACK_URL,
        }
      : null,
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
