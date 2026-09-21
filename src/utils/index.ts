export const taskBaseUri=`${process.env.NEXT_PUBLIC_BASEURL}/detail/`

// Regular expression to match email addresses
export const emailPattern = /[\w.-]+@[\w.-]+\.[A-Za-z]{2,}$/g;
export function absoluteUrl(path: string) {
    return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000/"
      }${path}`;
  }