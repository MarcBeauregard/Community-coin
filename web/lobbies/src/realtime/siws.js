// The exact text a wallet signs to sign in (Sign-In With Solana): readable, bound to the server's domain and a
// one-time nonce. Shared by the server (which checks it) and the app (which asks the wallet to sign it).

export function signInMessage(domain, address, nonce, issuedAt) {
  return `${domain} wants you to sign in with your Solana account:\n${address}\n\nSign in to Community Coin lobbies.\n\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt).toISOString()}`;
}
