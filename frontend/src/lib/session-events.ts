/** Window event the API client fires when a request answers 401. The auth
 *  store listens (pilot sign-in only) and returns the user to the sign-in
 *  screen once their session has ended. Its own module so neither the client
 *  nor the store has to import the other. */
export const UNAUTHENTICATED_EVENT = "ds:unauthenticated";
