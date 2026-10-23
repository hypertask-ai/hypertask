import { IUser } from "@/models/model";

interface IReturnIsValidUser {
  isValid: boolean;
  user: IUser | null;
}

export const transformUserObject = (user: any): any => {
  if (!user) return user;
  
  if (user.notificationPreference !== undefined) {
    return user;
  }
  
  return {
    ...user,
    notificationPreference: user.UserSetting?.notificationPreference || "direct",
  };
};

export const isValidUser = (cookie: any): IReturnIsValidUser => {
  try {
    if (!cookie) throw "";
    const parsedCookie = JSON.parse(cookie);
    if (parsedCookie.id && parsedCookie.displayName && parsedCookie.email) {
      return {
        isValid: true,
        user: transformUserObject(parsedCookie)
      }
    }
    else throw "";
  } catch (error) {
    return {
      isValid: false,
      user: null
    }
  }
};
