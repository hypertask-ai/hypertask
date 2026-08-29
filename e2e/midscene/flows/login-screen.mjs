export default {
  id: 'login-screen',
  area: 'auth',
  title: 'Login screen renders',
  description: 'Opens the login page and checks the email input and Google sign-in option are visible. Does not attempt to log in.',
  safe: true,
  steps: [
    { action: 'goto', arg: 'https://app.hypertask.ai/login' },
    { action: 'aiAssert', arg: 'an email address input field is visible on the page' },
    { action: 'aiAssert', arg: 'a "Sign in with Google" or Google sign-in button is visible on the page' },
  ],
};
