// The exact text a wallet signs to sign in (Sign-In With Solana): readable, bound to the server's domain and a
// one-time nonce. Shared by the server (which checks it) and the app (which asks the wallet to sign it).

// The fields follow Sign-In With Solana (CAIP-122): what a wallet can show and check, line by line.
export function signInMessage(domain, address, nonce, issuedAt, { uri = `https://${domain}`, chain = "solana:mainnet" } = {}) {
  return `${domain} wants you to sign in with your Solana account:\n${address}\n\nSign in to Community Coin lobbies. This proves the address is yours; it is not a transaction and costs nothing.\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chain}\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt).toISOString()}`;
}
