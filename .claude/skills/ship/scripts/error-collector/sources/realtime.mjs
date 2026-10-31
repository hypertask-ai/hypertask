import { fetchVercel } from './vercel.mjs';

export const name = 'realtime';

export async function fetch(context) { return fetchVercel(context, name); }
