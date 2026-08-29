import {
  getUTMDataFromCookies,
  getUTMDataFiltered as getFilteredUTMData,
} from "@/lib/utils/utm/client";

export function useUTM() {
  return {
    getUTMData: getUTMDataFromCookies,
    getUTMDataFiltered: getFilteredUTMData,
  };
}
