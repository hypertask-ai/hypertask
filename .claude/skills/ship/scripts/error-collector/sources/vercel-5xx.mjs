import { fetchVercel } from './vercel.mjs';
export const name = 'vercel-5xx';
export async function fetch(context) { return fetchVercel(context, name); }
