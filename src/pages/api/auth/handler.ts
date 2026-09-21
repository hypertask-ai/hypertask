import { withoutAuth } from "#with-auth";
import { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, state } = req.query;

  if (!code) {
    return res.redirect('/login?error=no_code');
  }

  // Handle the callback
  return res.redirect('/');
}

export default withoutAuth(handler);
