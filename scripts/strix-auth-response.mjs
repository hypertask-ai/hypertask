// An HTTP error proves authentication enforcement only when its meaning is known.
export async function isAuthRejection(response, expected400Error) {
  let body;
  if (response.status === 400 && expected400Error) {
    try { body = await response.json(); } catch { /* An unrecognized response cannot prove rejection. */ }
  }
  if (!response.bodyUsed) await response.body?.cancel();
  return response.status === 401 || response.status === 403 ||
    (response.status === 400 && expected400Error !== undefined &&
      body?.success === false && body.error === expected400Error);
}

export function isCliAuthRejection(result) {
  if (result.error || result.status === 0 || !Number.isInteger(result.status)) return false;
  let body;
  try { body = JSON.parse(result.stdout); } catch { return false; }
  return body?.success === false && typeof body.error === 'string' &&
    /\bunauthori[sz]ed\b/i.test(body.error) && /\b(?:authentication|token|credential)\b/i.test(body.error);
}
