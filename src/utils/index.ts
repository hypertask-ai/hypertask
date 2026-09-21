import { env as appEnv } from "#env";
export const taskBaseUri=`${appEnv.NEXT_PUBLIC_BASEURL}/detail/`

// Regular expression to match email addresses
export const emailPattern = /[\w.-]+@[\w.-]+\.[A-Za-z]{2,}$/g;
export function absoluteUrl(path: string) {
    return `${appEnv.NEXT_PUBLIC_APP_URL || "http://localhost:3000/"
      }${path}`;
  }