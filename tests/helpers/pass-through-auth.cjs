function passThroughAuth(getAuthSession = async () => null) {
  return {
    getAuthSession,
    withAuth: (handler) => handler,
    withoutAuth: (handler) => handler,
  };
}

module.exports = { passThroughAuth };
