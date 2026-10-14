import { fetchVercel } from './vercel.mjs';

export const name = 'realtime';

// Hosted Pusher has no VPS journal. The app logs failed trigger calls at warning level.
export async function fetch(context) { return fetchVercel(context, name); }
