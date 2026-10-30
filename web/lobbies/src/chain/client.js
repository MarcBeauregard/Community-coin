// Wallet mode: sends lobby operations to a deployed program and reads the result back from the chain. Each
// operation is one transaction signed by the wallet (Phantom and the like: `{ publicKey, signTransaction }`); the
// receipt is built from the events in its logs, so what the app shows is what the program did.

import { Buffer } from "buffer";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Addresses, lobbyInstruction, eventsFromLogs, decodeLobby, decodeIdea, decodePledge, errorName, toHex, ACCOUNT } from "./wire.js";

/** A lobby instruction as web3.js takes it. */
export function toInstruction(programId, ix) {
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: ix.keys.map(([k, isSigner, isWritable]) => ({ pubkey: new PublicKey(k), isSigner, isWritable })),
    data: Buffer.from(ix.data),
  });
}

/** The program error a failed transaction carries, by name ("PledgeCap", "AccountInUse", …), or null. */
export function programError(err) {
  const custom = err?.InstructionError?.[1]?.Custom;
  return custom === undefined ? null : errorName(custom);
}

export class LobbyClient {
  constructor({ rpc, programId, wallet, commitment = "confirmed" }) {
    this.connection = new Connection(rpc, commitment);
    this.programId = programId;
    this.addresses = new Addresses(programId);
    this.wallet = wallet;
  }

  /** Signs and sends one operation; resolves to `{ signature, events }` or rejects with `{ error }` (a program error name). */
  async send(op, args) {
    const me = this.wallet.publicKey.toBase58();
    const ix = lobbyInstruction(this.addresses, op, { ...args, user: args.user ?? me, payer: args.payer ?? me, proposer: args.proposer ?? me, host: args.host ?? me });
    const tx = new Transaction().add(toInstruction(this.programId, ix));
    tx.feePayer = this.wallet.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    const signed = await this.wallet.signTransaction(tx);
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    const done = await this.connection.confirmTransaction(signature);
    if (done.value.err) throw { error: programError(done.value.err) ?? "TransactionFailed", signature };
    const sent = await this.connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    return { signature, events: eventsFromLogs(sent?.meta?.logMessages) };
  }

  async lobby(id) {
    const info = await this.connection.getAccountInfo(new PublicKey(this.addresses.lobby(id)));
    return info ? decodeLobby(info.data) : null;
  }

  /** Every idea of a lobby, by index: the program's accounts that name this lobby and are Ideas (pledges name it too). */
  async ideas(id) {
    const lobby = this.addresses.lobby(id);
    const accounts = await this.connection.getProgramAccounts(new PublicKey(this.programId), { filters: [{ memcmp: { offset: 8, bytes: lobby } }] });
    return accounts
      .filter((a) => toHex(a.account.data.subarray(0, 8)) === ACCOUNT.Idea)
      .map((a) => decodeIdea(a.account.data))
      .sort((x, y) => x.index - y.index);
  }

  async pledge(id, user = this.wallet.publicKey.toBase58()) {
    const info = await this.connection.getAccountInfo(new PublicKey(this.addresses.pledge(this.addresses.lobby(id), user)));
    return info ? decodePledge(info.data) : null;
  }
}
