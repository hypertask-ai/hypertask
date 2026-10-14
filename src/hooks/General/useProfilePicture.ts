import { updateProfilePictureRoute } from "@/lib/constants/APIRouteConstants";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import { IUser } from "@/models/model";
import { currentUserAtom } from "@/store";
import { base64ToFile } from "@/utils/api/Task Detail";
import {
  convertFileToBase64,
  cropToCircle,
} from "@/utils/helperFunctions/helperFunctions";
import axios from "axios";
import nookies from "nookies";
import { ChangeEvent, useState, useEffect } from "react";
import toast from "react-hot-toast";
import { useRecoilState } from "@/lib/state";

export const useProfilePicture = (_currentUser: IUser | null) => {
  const [currentUser, setCurrentUser] = useState<IUser | null>(_currentUser);
  const [uploadedFile, setUploadedFile] = useState<File | undefined>(undefined);
  const [_, _setCurrentUser] = useRecoilState(currentUserAtom);
  const [defaultImage, setDefaultImage] = useState<string | undefined>(
    undefined
  );
  const [displayName, setDisplayName] = useState<string>(
    _currentUser?.displayName ?? ""
  );

  useEffect(() => {
    if (_currentUser?.displayName !== undefined) {
      setDisplayName(_currentUser.displayName);
    }
  }, [_currentUser?.displayName]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const selectedFile = files[0];

    await toast.promise(
      (async () => {
        const circularImageBlob = await cropToCircle(selectedFile);

        const circularImageFile = new File(
          [circularImageBlob],
          "profileImage.png",
          {
            type: "image/png",
          }
        );

        setUploadedFile(circularImageFile);

        const base64String = await convertFileToBase64(circularImageFile);

        const newUrl = await base64ToFile(
          base64String as string,
          "profileImage.png"
        );

        const updatedUser = await updateProfileAPI(newUrl);
        if (updatedUser) updateUserStateAndCookie(updatedUser);
      })().catch((error) => {
        console.log("🚀 ~ error:", error)
        throw error;
      }),
      {
        loading: "Uploading profile image...",
        success: "Profile image updated!",
        error: "Failed to update profile image.",
      }
    );
  };

  const updateUserStateAndCookie = (user: any) => {
    nookies.set(null, "nookies_user", JSON.stringify(slimUserForCookie(user)), {
      maxAge: 600 * 60 * 24 * 7,
      path: "/",
    });
    setCurrentUser(user);
    _setCurrentUser(user);
    toast("Refresh to view changes");
  };
  const removeProfilePicture = async () => {
    if (currentUser?.photoURL?.startsWith("https://lh3.googleusercontent.com"))
      return;
    const updatedUser = await updateProfileAPI();
    if (updatedUser) {
      updateUserStateAndCookie(updatedUser);
      setUploadedFile(undefined);
      setDefaultImage(updatedUser.userPicture.basePhotoURL);
    }
  };

  const updateProfileAPI = async (url?: string, displayName?: string) => {
    const response = await axios.post(updateProfilePictureRoute, { url, displayName });
    if (response.data.updateUser) return response.data.updateUser;
  };

  const updateDisplayName = async (newDisplayName: string) => {
    await toast.promise(
      (async () => {
        const updatedUser = await updateProfileAPI(undefined, newDisplayName);
        if (updatedUser) {
          updateUserStateAndCookie(updatedUser);
          setDisplayName(newDisplayName);
        }
      })().catch((error) => {
        console.log("🚀 ~ error:", error);
        throw error;
      }),
      {
        loading: "Updating display name...",
        success: "Display name updated!",
        error: "Failed to update display name.",
      }
    );
  };

  return {
    removeProfilePicture,
    handleFileUpload,
    uploadedFile,
    defaultImage,
    displayName,
    setDisplayName,
    updateDisplayName,
  };
};
