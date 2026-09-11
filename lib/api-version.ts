/**
 * Bump when the shape of an API response changes. The client appends it to
 * cacheable requests so a browser or CDN copy of the old shape is never
 * served to new code. (Data refreshes that keep the shape do not need it.)
 */
export const API_VERSION = "3";
