import { IUser } from "@/models/model";

interface IReturnIsValidUser {
  isValid: boolean;
  user: IUser | null;
}

/**
 * Transforms user object to flatten UserSetting properties to top level
 * Ensures notificationPreference is available directly on user object
 * 
 * @param user - User object from database (may have nested UserSetting)
 * @returns Transformed user object with flattened properties
 */
export const transformUserObject = (user: any): any => {
  if (!user) return user;
  
  // If notificationPreference already exists at top level, return as is
  if (user.notificationPreference !== undefined) {
    return user;
  }
  
  // Flatten notificationPreference from UserSetting to top level
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
