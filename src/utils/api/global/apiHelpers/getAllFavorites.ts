import { consumeEarlyAppShellBootstrapSlice } from "@/lib/appShellBootstrap/client";
import axios from "axios"



// get all notifications for a user 
export const getAllFavorites = async (userSettingId:string|null) => {
    if (userSettingId){
        try {
            const bootstrapped = await consumeEarlyAppShellBootstrapSlice<unknown[]>("favorites");
            if (Array.isArray(bootstrapped)) return bootstrapped;
            const favoritesAll = await axios.get("/api/favorites/getFavorites")
            return favoritesAll.data;
        } catch (error) {
            // Handle the error or return a default value
            console.error("Error getting Assignees and Members:", error);
            throw error; // You can also return a default value or handle the error in a different way
        }

    }
    // Returning undefined makes React Query throw "Query data cannot be
    // undefined" on every page that renders before UserSettingId is known
    // (public /share links never have one).
    return [];
}




