import { publicMember } from './member.presenter.js';
export function mountMembers(app, requireMember) {
  app.get('/api/members/me', requireMember, (req, res) =>
    res.json({ member: publicMember(req.member) }),
  );
}
