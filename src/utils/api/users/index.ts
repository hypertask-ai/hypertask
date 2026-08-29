import globalConstants from "@/lib/constants";
import { IUser } from "@/models/model";
import axiosClient, { ApiResponse } from "@/utils/axiosClient";
import axios from "axios";



// ---------------------- FETCH COMMENTS ---------------
export const addDevice = async (fcmToken: string) => {
  const response = await axios.post(`/api/users/addDevice`, { fcmToken: fcmToken });
  return response.data

}

type TReqPayload = {
  email: string | null;
  user: {
    photoURL: string | null;
    displayName: string | null;
    email: string | null;
    uid: string;
  };
  shouldSkipInteractive?: boolean;
}

type TRes = {
  message: string;
  user: IUser;
  isNewUser: boolean;
}

export const USER_API_CONTROLLER = {
  /**
   * Retrieves the chat history for a given session ID.
   * 
   * @param payload - payload of user .
   * @returns A promise resolving to the chat history of the session.
   */
  getorUpdateUser: async (payload: TReqPayload): Promise<ApiResponse<TRes>> => {
    return axiosClient.post<TRes>(globalConstants.GetORUpdateUserAPIRoute, payload);
  },
}