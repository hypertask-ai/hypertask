// An HTTP error proves authentication enforcement only when its meaning is known.
export function isAuthRejection(status, body, expected400Error) {
  return status === 401 || status === 403 ||
    (status === 400 && expected400Error !== undefined &&
      body?.success === false && body.error === expected400Error);
}
