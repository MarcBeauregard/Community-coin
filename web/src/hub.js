// Typed access to the CommunityCoin hub and its meme tokens, over either chain.

import { Interface, ZeroAddress } from "ethers";
import contracts from "./contracts.json";
import { Reverted } from "./chain.js";

export const hubAbi = new Interface(contracts.CommunityCoin.abi);
export const tokenAbi = new Interface(contracts.MemeToken.abi);

const MESSAGES = {
  MemeExists: "This ticker is taken. Buy the original or launch a variant.",
  UnknownMeme: "This meme does not exist.",
  InvalidSymbol: "Invalid ticker: use 1 to 16 letters or digits.",
  TooDeep: "Lineage too deep: 6 levels at most.",
  OpeningClosed: "The opening is over. Buy on the curve instead.",
  StillOpening: "The opening is still running. Commit to the auction or wait for it to close.",
  AlreadySettled: "The opening is already settled.",
  NothingToClaim: "Nothing to claim yet.",
  ZeroAmount: "The amount must be above zero.",
  WrongValue: "The ETH amount does not match how this meme is quoted.",
  Slippage: "The price moved beyond your slippage. Try again.",
  NotRoot: "Only a root meme (quoted in ETH) can join another family.",
  CycleDetected: "These two memes are already in the same family.",
  UnknownUnion: "This union proposal does not exist.",
  VotingOpen: "The vote is still open. The union executes after the deadline.",
  VotingClosed: "The vote is closed.",
  QuorumNotReached: "No majority: more than half of the circulating supply must be locked.",
  ReserveTooSmall: "Reserve too small for a union (0.001 ETH minimum).",
  EthTransferFailed: "The ETH transfer failed.",
  ERC20InsufficientBalance: "Insufficient token balance.",
};

export function explain(error) {
  if (!(error instanceof Reverted)) return error?.shortMessage ?? error?.message ?? String(error);
  if (error.reason === "insufficient balance") return "Insufficient ETH balance.";
  for (const abi of [hubAbi, tokenAbi]) {
    try {
      const parsed = abi.parseError(error.data);
      if (parsed) return MESSAGES[parsed.name] ?? parsed.name;
    } catch {}
  }
  return "The contract rejected the transaction.";
}

export class Hub {
  static async deploy(chain, from, args) {
    const data = contracts.CommunityCoin.bytecode + hubAbi.encodeDeploy(args).slice(2);
    return new Hub(chain, await chain.deploy(from, data));
  }

  constructor(chain, address) {
    this.chain = chain;
    this.address = address;
  }

  async read(fn, args = []) {
    const ret = await this.chain.call(ZeroAddress, this.address, hubAbi.encodeFunctionData(fn, args));
    const out = hubAbi.decodeFunctionResult(fn, ret);
    return out.length === 1 ? out[0] : out;
  }

  async token(token, fn, args = []) {
    const ret = await this.chain.call(ZeroAddress, token, tokenAbi.encodeFunctionData(fn, args));
    const out = tokenAbi.decodeFunctionResult(fn, ret);
    return out.length === 1 ? out[0] : out;
  }

  /** Sends a transaction and returns the hub events it emitted. */
  async write(from, fn, args = [], value = 0n) {
    const receipt = await this.chain.send(from, this.address, hubAbi.encodeFunctionData(fn, args), value);
    const events = [];
    for (const log of receipt.logs) {
      if (log.address !== this.address) continue;
      try {
        events.push(hubAbi.parseLog(log));
      } catch {}
    }
    return { events, timestamp: receipt.timestamp };
  }
}
