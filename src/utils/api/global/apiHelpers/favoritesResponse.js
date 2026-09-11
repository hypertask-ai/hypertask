/**
 * Favorites list from API/bootstrap must be an array; anything else is empty.
 * @param {unknown} data
 * @returns {any[]}
 */
export const selectFavorites = (data) =>
  Array.isArray(data) ? data : [];
