/**
 * Favorites list from API/bootstrap must be an array; anything else is empty.
 * @param {unknown} data
 * @returns {unknown[]}
 */
export const selectFavorites = (data) =>
  Array.isArray(data) ? data : [];
