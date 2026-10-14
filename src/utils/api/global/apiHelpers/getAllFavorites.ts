import { consumeEarlyAppShellBootstrapSlice } from "@/lib/appShellBootstrap/client";
import { selectFavorites } from "@/utils/api/global/apiHelpers/favoritesResponse";
import axios from "axios"

export const getAllFavorites = async (userSettingId:string|null) => {
    if (userSettingId){
        try {
            const bootstrapped = await consumeEarlyAppShellBootstrapSlice<unknown[]>("favorites");
            if (Array.isArray(bootstrapped)) return bootstrapped;
            const favoritesAll = await axios.get("/api/favorites/getFavorites")
            return selectFavorites(favoritesAll.data);
        } catch (error) {
            console.error("Error getting Assignees and Members:", error);
            throw error;
        }

    }
    return [];
}




